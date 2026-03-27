/**
 * Rome MCP Server — Streamable HTTP transport mounted at /mcp
 *
 * Exposes 4 tools: rome_get_graph, rome_create_task, rome_update_task, rome_status_report
 * Auth: Bearer token checked against MCP_AUTH_TOKEN env var
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { type Request, type Response, type RequestHandler } from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import type { Db } from "../db.js";
import {
  getGraph,
  createNode,
  updateNode,
  createEdge,
  resolveNodeByName,
  generateStatusReport,
} from "../services.js";
import { broadcast } from "../socket.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const MCP_SERVICE_USER_ID = "mcp-service-user-00000000";

const textContent = (text: string) => ({ type: "text" as const, text });

// ---------------------------------------------------------------------------
// MCP Server Factory
// ---------------------------------------------------------------------------

// Creates a fresh McpServer instance with all tools registered.
// Each session needs its own server (the SDK binds one transport per server).
function createMcpServer(db: Db): McpServer {
  const mcp = new McpServer(
    { name: "rome-mcp", version: "1.0.0" },
    { capabilities: { tools: {} } },
  );

  // ---- Tool 1: rome_get_graph ------------------------------------------------
  mcp.tool(
    "rome_get_graph",
    "Returns the full project graph — all nodes with statuses, owners, priorities, dates, budgets, RACI, and all edges. Use this to understand the current state of the project.",
    {
      workstream: z.string().optional(),
      status: z.string().optional(),
    },
    async ({ workstream, status }) => {
      try {
        const filters: { workstream?: string; status?: string } = {};
        if (workstream) filters.workstream = workstream;
        if (status) filters.status = status;

        const graph = getGraph(db, filters);
        return {
          content: [textContent(JSON.stringify(graph, null, 2))],
        };
      } catch (err) {
        console.error("[MCP] tool error:", err);
        return {
          content: [
            textContent(JSON.stringify({ error: "db_unavailable", details: String(err) })),
          ],
          isError: true,
        };
      }
    },
  );

  // ---- Tool 2: rome_create_task ----------------------------------------------
  mcp.tool(
    "rome_create_task",
    "Creates a new task node and optionally links it under a parent workstream or cluster via a parent_of edge.",
    {
      name: z.string(),
      workstream: z.string().optional(),
      cluster: z.string().optional(),
      status: z
        .enum(["not_started", "in_progress", "blocked", "done", "cancelled"])
        .optional(),
      priority: z.enum(["P0", "P1", "P2", "P3"]).optional(),
      start_date: z.string().optional(),
      end_date: z.string().optional(),
      budget: z.number().optional(),
    },
    async (args) => {
      try {
        // 1. Resolve workstream / cluster parent node
        let parentId: string | undefined;
        let workstreamValue: string | undefined = args.workstream ?? undefined;

        if (args.workstream) {
          const wsResult = resolveNodeByName(db, args.workstream);
          if (wsResult.status === "no_match") {
            return {
              content: [
                textContent(JSON.stringify({ error: "workstream_not_found", query: args.workstream })),
              ],
              isError: true,
            };
          }
          if (wsResult.status === "ambiguous") {
            return {
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify({
                    error: "workstream_ambiguous",
                    query: args.workstream,
                    candidates: wsResult.candidates,
                  }),
                },
              ],
              isError: true,
            };
          }
          // "found" or "not_a_task" — both have .node; for workstreams, not_a_task is expected
          parentId = wsResult.node.id;
          workstreamValue = wsResult.node.workstream ?? wsResult.node.name;
        }

        if (args.cluster) {
          const clResult = resolveNodeByName(db, args.cluster);
          if (clResult.status === "no_match") {
            return {
              content: [
                textContent(JSON.stringify({ error: "cluster_not_found", query: args.cluster })),
              ],
              isError: true,
            };
          }
          if (clResult.status === "ambiguous") {
            return {
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify({
                    error: "cluster_ambiguous",
                    query: args.cluster,
                    candidates: clResult.candidates,
                  }),
                },
              ],
              isError: true,
            };
          }
          // Cluster takes precedence as the edge parent
          parentId = clResult.node.id;
        }

        // 2. Create the node
        const node = createNode(
          db,
          {
            name: args.name,
            workstream: workstreamValue,
            status: args.status,
            priority: args.priority,
            start_date: args.start_date,
            end_date: args.end_date,
            budget: args.budget,
          },
          MCP_SERVICE_USER_ID,
        );

        // 3. Broadcast node creation
        broadcast({ type: "node:created", payload: node as unknown as Record<string, unknown> });

        // 4. Create parent_of edge if we resolved a parent
        let edge: Record<string, unknown> | undefined;
        if (parentId) {
          const edgeResult = createEdge(
            db,
            { source_id: parentId, target_id: node.id, type: "parent_of" },
            MCP_SERVICE_USER_ID,
          );
          // createEdge returns EdgeRecord | { error, code }
          if ("error" in edgeResult) {
            // Edge creation failed, but node was created — return partial success
            return {
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify(
                    { node, edge: null, edge_error: edgeResult },
                    null,
                    2,
                  ),
                },
              ],
            };
          }
          edge = edgeResult as unknown as Record<string, unknown>;
          broadcast({ type: "edge:created", payload: edge });
        }

        return {
          content: [
            textContent(JSON.stringify({ node, edge: edge ?? null }, null, 2)),
          ],
        };
      } catch (err) {
        console.error("[MCP] tool error:", err);
        return {
          content: [
            textContent(JSON.stringify({ error: "create_failed", details: String(err) })),
          ],
          isError: true,
        };
      }
    },
  );

  // ---- Tool 3: rome_update_node ----------------------------------------------
  mcp.tool(
    "rome_update_node",
    "Updates fields on any node (task, node group, or workstream). Accepts the node by name or ID. Can rename, change status, priority, dates, budget, RACI, workstream, notes, and deliverables.",
    {
      id_or_name: z.string(),
      name: z.string().optional(),
      status: z
        .enum(["not_started", "in_progress", "blocked", "done", "cancelled"])
        .optional(),
      priority: z.enum(["P0", "P1", "P2", "P3"]).optional(),
      start_date: z.string().optional(),
      end_date: z.string().optional(),
      budget: z.number().optional(),
      workstream: z.string().nullable().optional(),
      notes: z.string().nullable().optional(),
      deliverable: z.string().nullable().optional(),
      raci: z
        .object({
          responsible: z.union([z.string(), z.array(z.string())]).optional(),
          accountable: z.union([z.string(), z.array(z.string())]).optional(),
          consulted: z.union([z.string(), z.array(z.string())]).optional(),
          informed: z.union([z.string(), z.array(z.string())]).optional(),
        })
        .optional(),
    },
    async (args) => {
      try {
        const result = resolveNodeByName(db, args.id_or_name);

        if (result.status === "no_match") {
          return {
            content: [textContent(JSON.stringify({ error: "no_match", query: args.id_or_name }))],
            isError: true,
          };
        }

        if (result.status === "ambiguous") {
          return {
            content: [textContent(JSON.stringify({ status: "ambiguous", candidates: result.candidates }))],
            isError: true,
          };
        }

        // Accept both "found" and "not_a_task" — we can edit any node
        const nodeId = result.node.id;

        const patch: Record<string, unknown> = {};
        if (args.name !== undefined) patch.name = args.name;
        if (args.status !== undefined) patch.status = args.status;
        if (args.priority !== undefined) patch.priority = args.priority;
        if (args.start_date !== undefined) patch.start_date = args.start_date;
        if (args.end_date !== undefined) patch.end_date = args.end_date;
        if (args.budget !== undefined) patch.budget = args.budget;
        if (args.workstream !== undefined) patch.workstream = args.workstream;
        if (args.notes !== undefined) patch.notes = args.notes;
        if (args.deliverable !== undefined) patch.deliverable = args.deliverable;
        if (args.raci !== undefined) patch.raci = args.raci;

        const updated = updateNode(db, nodeId, patch, MCP_SERVICE_USER_ID);
        if (!updated) {
          return {
            content: [textContent(JSON.stringify({ error: "update_failed", details: "Node not found during update" }))],
            isError: true,
          };
        }

        broadcast({ type: "node:updated", payload: updated as unknown as Record<string, unknown> });
        return { content: [textContent(JSON.stringify(updated, null, 2))] };
      } catch (err) {
        console.error("[MCP] tool error:", err);
        return {
          content: [textContent(JSON.stringify({ error: "update_failed", details: String(err) }))],
          isError: true,
        };
      }
    },
  );

  // ---- Tool 5: rome_create_node_group ----------------------------------------
  mcp.tool(
    "rome_create_node_group",
    "Creates a new node group under a workstream. The node group becomes a collapsible container in the graph view. Automatically creates parent_of and produces edges to link it to the workstream.",
    {
      name: z.string(),
      workstream: z.string().describe("Name of the parent workstream"),
      priority: z.enum(["P0", "P1", "P2", "P3"]).optional(),
    },
    async (args) => {
      try {
        // Resolve workstream header
        const wsResult = resolveNodeByName(db, args.workstream);
        if (wsResult.status === "no_match") {
          return {
            content: [textContent(JSON.stringify({ error: "workstream_not_found", query: args.workstream }))],
            isError: true,
          };
        }
        if (wsResult.status === "ambiguous") {
          return {
            content: [textContent(JSON.stringify({ error: "workstream_ambiguous", query: args.workstream, candidates: wsResult.candidates }))],
            isError: true,
          };
        }
        const wsHeader = wsResult.node;
        const workstreamValue = wsHeader.workstream ?? wsHeader.name;

        // Create node group
        const node = createNode(
          db,
          {
            name: args.name,
            workstream: workstreamValue,
            priority: args.priority ?? "P1",
            status: "not_started",
          },
          MCP_SERVICE_USER_ID,
        );
        broadcast({ type: "node:created", payload: node as unknown as Record<string, unknown> });

        // parent_of: workstream → node group
        const parentEdge = createEdge(db, { source_id: wsHeader.id, target_id: node.id, type: "parent_of" }, MCP_SERVICE_USER_ID);
        if (!("error" in parentEdge)) {
          broadcast({ type: "edge:created", payload: parentEdge as unknown as Record<string, unknown> });
        }

        // produces: node group → workstream (feeds into)
        const producesEdge = createEdge(db, { source_id: node.id, target_id: wsHeader.id, type: "produces" }, MCP_SERVICE_USER_ID);
        if (!("error" in producesEdge)) {
          broadcast({ type: "edge:created", payload: producesEdge as unknown as Record<string, unknown> });
        }

        return {
          content: [textContent(JSON.stringify({ node, parent_edge: parentEdge, produces_edge: producesEdge }, null, 2))],
        };
      } catch (err) {
        console.error("[MCP] tool error:", err);
        return {
          content: [textContent(JSON.stringify({ error: "create_failed", details: String(err) }))],
          isError: true,
        };
      }
    },
  );

  // ---- Tool 6: rome_create_edge ----------------------------------------------
  mcp.tool(
    "rome_create_edge",
    "Creates a relationship (edge) between two nodes. Use this for dependency management: 'produces' (A feeds into B), 'blocks' (A blocks B), 'depends_on' (A depends on B), 'sequence' (A must happen before B). Accepts node names or IDs.",
    {
      source: z.string().describe("Name or ID of the source node"),
      target: z.string().describe("Name or ID of the target node"),
      type: z.enum(["produces", "blocks", "blocker", "depends_on", "sequence", "feeds", "shared"]),
    },
    async (args) => {
      try {
        // Resolve source
        const srcResult = resolveNodeByName(db, args.source);
        if (srcResult.status === "no_match") {
          return {
            content: [textContent(JSON.stringify({ error: "source_not_found", query: args.source }))],
            isError: true,
          };
        }
        if (srcResult.status === "ambiguous") {
          return {
            content: [textContent(JSON.stringify({ error: "source_ambiguous", query: args.source, candidates: srcResult.candidates }))],
            isError: true,
          };
        }

        // Resolve target
        const tgtResult = resolveNodeByName(db, args.target);
        if (tgtResult.status === "no_match") {
          return {
            content: [textContent(JSON.stringify({ error: "target_not_found", query: args.target }))],
            isError: true,
          };
        }
        if (tgtResult.status === "ambiguous") {
          return {
            content: [textContent(JSON.stringify({ error: "target_ambiguous", query: args.target, candidates: tgtResult.candidates }))],
            isError: true,
          };
        }

        const sourceId = srcResult.node.id;
        const targetId = tgtResult.node.id;

        const edge = createEdge(db, { source_id: sourceId, target_id: targetId, type: args.type }, MCP_SERVICE_USER_ID);
        if ("error" in edge) {
          return {
            content: [textContent(JSON.stringify(edge))],
            isError: true,
          };
        }

        broadcast({ type: "edge:created", payload: edge as unknown as Record<string, unknown> });
        return {
          content: [textContent(JSON.stringify({
            edge,
            source: { id: srcResult.node.id, name: srcResult.node.name },
            target: { id: tgtResult.node.id, name: tgtResult.node.name },
          }, null, 2))],
        };
      } catch (err) {
        console.error("[MCP] tool error:", err);
        return {
          content: [textContent(JSON.stringify({ error: "create_edge_failed", details: String(err) }))],
          isError: true,
        };
      }
    },
  );

  // ---- Tool 4: rome_status_report --------------------------------------------
  mcp.tool(
    "rome_status_report",
    "Generates a structured status report from current project state. Groups by workstream, highlights blocked items, summarizes progress.",
    {
      format: z.enum(["brief", "detailed", "investor"]).optional(),
    },
    async ({ format }) => {
      try {
        const reportFormat = format ?? "brief";
        const markdown = generateStatusReport(db, reportFormat);
        return {
          content: [textContent(markdown)],
        };
      } catch (err) {
        console.error("[MCP] tool error:", err);
        return {
          content: [
            textContent(JSON.stringify({ error: "db_unavailable", details: String(err) })),
          ],
          isError: true,
        };
      }
    },
  );

  return mcp;
}

// ---------------------------------------------------------------------------
// Express Handler Factory
// ---------------------------------------------------------------------------

export function createMcpHandler(db: Db): RequestHandler {
  const handler: RequestHandler = async (req: Request, res: Response) => {
    console.log(`[MCP] ${req.method} ${req.url}`);

    // --- Auth check ---
    const authToken = process.env.MCP_AUTH_TOKEN;
    if (!authToken) {
      res.status(401).json({ error: "MCP_AUTH_TOKEN not configured on server" });
      return;
    }

    const authHeader = req.headers.authorization;
    if (!authHeader || authHeader !== `Bearer ${authToken}`) {
      // MCP spec: 401 must include WWW-Authenticate with resource_metadata pointing to PRM
      const proto = req.get("x-forwarded-proto") || req.protocol;
      const base = `${proto}://${req.get("host")}`;
      res.setHeader(
        "WWW-Authenticate",
        `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource"`,
      );
      res.status(401).json({ error: "Invalid or missing bearer token" });
      return;
    }

    // Accept POST (tool calls), GET (SSE stream), DELETE (session cleanup)
    if (!["POST", "GET", "DELETE"].includes(req.method)) {
      res.status(405).json({ error: "Method not allowed" });
      return;
    }

    // GET without Accept: text/event-stream is likely a browser probe — return info
    if (req.method === "GET" && !req.headers.accept?.includes("text/event-stream")) {
      res.json({ name: "rome-mcp", version: "1.0.0", status: "ok" });
      return;
    }

    try {
      const mcp = createMcpServer(db);
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      });

      res.on("close", () => {
        transport.close().catch(() => {});
      });

      await mcp.connect(transport);
      await transport.handleRequest(
        req as unknown as IncomingMessage,
        res as unknown as ServerResponse,
        req.body,
      );
    } catch (err) {
      console.error("[MCP] Handler error:", err);
      if (!res.headersSent) {
        res.status(500).json({ error: "MCP transport error" });
      }
    }
  };

  return handler;
}
