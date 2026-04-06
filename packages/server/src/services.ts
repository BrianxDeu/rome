import { eq, and, gte, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { nodes, edges, auditLog } from "@rome/shared/schema";
import type { Db } from "./db.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

const createNodeSchema = z.object({
  name: z.string().min(1),
  status: z.enum(["not_started", "in_progress", "blocked", "done", "cancelled"]).optional(),
  priority: z.enum(["P0", "P1", "P2", "P3"]).optional(),
  start_date: z.string().nullable().optional(),
  end_date: z.string().nullable().optional(),
  budget: z.number().nullable().optional(),
  deliverable: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  raci: z.any().nullable().optional(),
  workstream: z.string().nullable().optional(),
  x: z.number().nullable().optional(),
  y: z.number().nullable().optional(),
  position_pinned: z.boolean().optional(),
  attachments: z.array(z.object({ name: z.string(), url: z.string() })).optional(),
});

const updateNodeSchema = createNodeSchema.partial().omit({ name: true }).extend({
  name: z.string().min(1).optional(),
});

const createEdgeSchema = z.object({
  source_id: z.string(),
  target_id: z.string(),
  type: z.enum(["blocks", "blocker", "depends_on", "sequence", "produces", "feeds", "shared", "parent_of"]),
});

export { createNodeSchema, updateNodeSchema, createEdgeSchema };

export type CreateNodeInput = z.infer<typeof createNodeSchema>;
export type UpdateNodeInput = z.infer<typeof updateNodeSchema>;
export type CreateEdgeInput = z.infer<typeof createEdgeSchema>;

export type NodeRecord = typeof nodes.$inferSelect;
export type EdgeRecord = typeof edges.$inferSelect;

export type ResolveResult =
  | { status: "found"; node: NodeRecord }
  | { status: "not_a_task"; node: NodeRecord }
  | { status: "ambiguous"; candidates: { id: string; name: string; workstream: string | null }[] }
  | { status: "no_match" };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DEPENDENCY_TYPES = new Set(["blocks", "blocker", "depends_on", "sequence"]);

function wouldCreateCycle(db: Db, sourceId: string, targetId: string): boolean {
  const visited = new Set<string>();
  const stack = [targetId];

  while (stack.length > 0) {
    const current = stack.pop()!;
    if (current === sourceId) return true;
    if (visited.has(current)) continue;
    visited.add(current);

    const outgoing = db
      .select()
      .from(edges)
      .where(eq(edges.sourceId, current))
      .all()
      .filter((e) => DEPENDENCY_TYPES.has(e.type));

    for (const edge of outgoing) {
      stack.push(edge.targetId);
    }
  }

  return false;
}

function buildParentMap(db: Db): Map<string, string[]> {
  const parentEdges = db
    .select()
    .from(edges)
    .where(eq(edges.type, "parent_of"))
    .all();

  const childrenMap = new Map<string, string[]>();
  for (const e of parentEdges) {
    const children = childrenMap.get(e.sourceId) ?? [];
    children.push(e.targetId);
    childrenMap.set(e.sourceId, children);
  }
  return childrenMap;
}

function computeRollup(
  nodeId: string,
  budgetMap: Map<string, number>,
  childrenMap: Map<string, string[]>,
  memo: Map<string, number>,
): number {
  if (memo.has(nodeId)) return memo.get(nodeId)!;

  const own = budgetMap.get(nodeId) ?? 0;
  const children = childrenMap.get(nodeId) ?? [];
  let total = own;

  for (const childId of children) {
    total += computeRollup(childId, budgetMap, childrenMap, memo);
  }

  memo.set(nodeId, total);
  return total;
}

// ---------------------------------------------------------------------------
// 1. createNode
// ---------------------------------------------------------------------------

export function createNode(db: Db, input: CreateNodeInput, userId: string): NodeRecord {
  const parsed = createNodeSchema.parse(input);

  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  db.insert(nodes)
    .values({
      id,
      name: parsed.name,
      status: parsed.status ?? "not_started",
      priority: parsed.priority ?? "P2",
      startDate: parsed.start_date ?? null,
      endDate: parsed.end_date ?? null,
      budget: parsed.budget ?? null,
      deliverable: parsed.deliverable ?? null,
      notes: parsed.notes ?? null,
      raci: parsed.raci ? (typeof parsed.raci === "string" ? parsed.raci : JSON.stringify(parsed.raci)) : null,
      workstream: parsed.workstream ?? null,
      x: parsed.x ?? null,
      y: parsed.y ?? null,
      positionPinned: parsed.position_pinned ? 1 : 0,
      attachments: parsed.attachments ? (typeof parsed.attachments === "string" ? parsed.attachments : JSON.stringify(parsed.attachments)) : null,
      createdBy: userId,
      createdAt: now,
      updatedAt: now,
    })
    .run();

  return db.select().from(nodes).where(eq(nodes.id, id)).get()!;
}

// ---------------------------------------------------------------------------
// 2. updateNode
// ---------------------------------------------------------------------------

export function updateNode(db: Db, id: string, patch: UpdateNodeInput, _userId: string): NodeRecord | null {
  const parsed = updateNodeSchema.parse(patch);

  const existing = db.select().from(nodes).where(eq(nodes.id, id)).get();
  if (!existing) return null;

  const changes: Record<string, unknown> = { updatedAt: new Date().toISOString() };

  if (parsed.name !== undefined) changes.name = parsed.name;
  if (parsed.status !== undefined) changes.status = parsed.status;
  if (parsed.priority !== undefined) changes.priority = parsed.priority;
  if (parsed.start_date !== undefined) changes.startDate = parsed.start_date;
  if (parsed.end_date !== undefined) changes.endDate = parsed.end_date;
  if (parsed.budget !== undefined) changes.budget = parsed.budget;
  if (parsed.deliverable !== undefined) changes.deliverable = parsed.deliverable;
  if (parsed.notes !== undefined) changes.notes = parsed.notes;
  if (parsed.raci !== undefined) changes.raci = parsed.raci ? (typeof parsed.raci === "string" ? parsed.raci : JSON.stringify(parsed.raci)) : null;
  if (parsed.workstream !== undefined) changes.workstream = parsed.workstream;
  if (parsed.x !== undefined) changes.x = parsed.x;
  if (parsed.y !== undefined) changes.y = parsed.y;
  if (parsed.position_pinned !== undefined) changes.positionPinned = parsed.position_pinned ? 1 : 0;
  if (parsed.attachments !== undefined) changes.attachments = parsed.attachments ? (typeof parsed.attachments === "string" ? parsed.attachments : JSON.stringify(parsed.attachments)) : null;

  db.update(nodes).set(changes).where(eq(nodes.id, id)).run();
  return db.select().from(nodes).where(eq(nodes.id, id)).get()!;
}

// ---------------------------------------------------------------------------
// 3. createEdge
// ---------------------------------------------------------------------------

export function createEdge(
  db: Db,
  input: CreateEdgeInput,
  userId: string,
): EdgeRecord | { error: string; code: string } {
  const parsed = createEdgeSchema.safeParse(input);
  if (!parsed.success) {
    return { error: "Invalid input", code: "VALIDATION_ERROR" };
  }

  const { source_id, target_id, type } = parsed.data;

  if (source_id === target_id) {
    return { error: "Self-referencing edges are not allowed", code: "SELF_REFERENCE" };
  }

  const source = db.select().from(nodes).where(eq(nodes.id, source_id)).get();
  const target = db.select().from(nodes).where(eq(nodes.id, target_id)).get();
  if (!source || !target) {
    return { error: "Node not found", code: "NOT_FOUND" };
  }

  if (DEPENDENCY_TYPES.has(type)) {
    if (wouldCreateCycle(db, source_id, target_id)) {
      return { error: "Edge would create a cycle", code: "CYCLE_DETECTED" };
    }
  }

  if (type === "parent_of") {
    const existingParent = db
      .select()
      .from(edges)
      .where(and(eq(edges.targetId, target_id), eq(edges.type, "parent_of")))
      .get();

    if (existingParent) {
      return { error: "Node already has a parent", code: "MULTIPLE_PARENTS" };
    }
  }

  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  db.insert(edges)
    .values({
      id,
      sourceId: source_id,
      targetId: target_id,
      type,
      createdBy: userId,
      createdAt: now,
      updatedAt: now,
    })
    .run();

  return db.select().from(edges).where(eq(edges.id, id)).get()!;
}

// ---------------------------------------------------------------------------
// 4. getGraph
// ---------------------------------------------------------------------------

export function getGraph(
  db: Db,
  filters?: { workstream?: string; status?: string },
): { nodes: NodeRecord[]; edges: EdgeRecord[] } {
  let allNodes: NodeRecord[];

  if (filters?.workstream || filters?.status) {
    const conditions: SQL[] = [];
    if (filters.workstream) conditions.push(eq(nodes.workstream, filters.workstream));
    if (filters.status) conditions.push(eq(nodes.status, filters.status));

    let query = db.select().from(nodes);
    query = query.where(and(...conditions)) as typeof query;
    allNodes = query.all();
  } else {
    allNodes = db.select().from(nodes).all();
  }

  // If filters produced no nodes, return empty
  if (allNodes.length === 0) {
    return { nodes: [], edges: [] };
  }

  const allEdges = db.select().from(edges).all();

  // When filtering, only include edges where both endpoints are in the node set
  if (filters?.workstream || filters?.status) {
    const nodeIds = new Set(allNodes.map((n) => n.id));
    const filteredEdges = allEdges.filter(
      (e) => nodeIds.has(e.sourceId) && nodeIds.has(e.targetId),
    );
    return { nodes: allNodes, edges: filteredEdges };
  }

  return { nodes: allNodes, edges: allEdges };
}

// ---------------------------------------------------------------------------
// 5. resolveNodeByName
// ---------------------------------------------------------------------------

export function resolveNodeByName(db: Db, query: string): ResolveResult {
  const allNodes = db.select().from(nodes).all();
  const lowerQuery = query.toLowerCase();

  const matches = allNodes.filter((n) =>
    n.name.toLowerCase().includes(lowerQuery),
  );

  if (matches.length === 0) {
    return { status: "no_match" };
  }

  if (matches.length > 1) {
    return {
      status: "ambiguous",
      candidates: matches.map((n) => ({ id: n.id, name: n.name, workstream: n.workstream })),
    };
  }

  // Exactly one match — check if structural
  const node = matches[0]!;
  const hasChildren = db
    .select()
    .from(edges)
    .where(and(eq(edges.sourceId, node.id), eq(edges.type, "parent_of")))
    .get();

  if (hasChildren) {
    return { status: "not_a_task", node };
  }

  return { status: "found", node };
}

// ---------------------------------------------------------------------------
// 6. generateStatusReport
// ---------------------------------------------------------------------------

export function generateStatusReport(
  db: Db,
  format: "brief" | "detailed" | "investor",
): string {
  const { nodes: allNodes, edges: allEdges } = getGraph(db);

  // Build parent map from already-fetched edges (avoid redundant DB query)
  const childrenMap = new Map<string, string[]>();
  for (const e of allEdges) {
    if (e.type === "parent_of") {
      const children = childrenMap.get(e.sourceId) ?? [];
      children.push(e.targetId);
      childrenMap.set(e.sourceId, children);
    }
  }

  // Build set of structural node IDs (nodes with outgoing parent_of edges)
  const structuralIds = new Set<string>();
  for (const e of allEdges) {
    if (e.type === "parent_of") {
      structuralIds.add(e.sourceId);
    }
  }

  // Only leaf tasks (non-structural)
  const tasks = allNodes.filter((n) => !structuralIds.has(n.id));

  // Group tasks by workstream
  const workstreamTasks = new Map<string, NodeRecord[]>();
  for (const t of tasks) {
    const ws = t.workstream ?? "unassigned";
    const list = workstreamTasks.get(ws) ?? [];
    list.push(t);
    workstreamTasks.set(ws, list);
  }

  // Stale threshold: 7 days ago
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  // Budget rollup
  const budgetMap = new Map<string, number>();
  for (const n of allNodes) {
    if (n.budget != null) budgetMap.set(n.id, n.budget);
  }
  const rollupMemo = new Map<string, number>();

  // Find root nodes for budget totals
  const childNodeIds = new Set<string>();
  for (const e of allEdges) {
    if (e.type === "parent_of") childNodeIds.add(e.targetId);
  }
  const rootNodeIds = allNodes.filter((n) => !childNodeIds.has(n.id)).map((n) => n.id);

  if (format === "brief") {
    const lines: string[] = ["# Status Report (Brief)", ""];
    for (const [ws, wsTasks] of workstreamTasks) {
      const done = wsTasks.filter((t) => t.status === "done").length;
      const pct = wsTasks.length > 0 ? Math.round((done / wsTasks.length) * 100) : 0;
      lines.push(`- **${ws}**: ${pct}% complete (${done}/${wsTasks.length} tasks)`);
    }
    return lines.join("\n");
  }

  if (format === "detailed") {
    const lines: string[] = ["# Status Report (Detailed)", ""];

    for (const [ws, wsTasks] of workstreamTasks) {
      const done = wsTasks.filter((t) => t.status === "done").length;
      const pct = wsTasks.length > 0 ? Math.round((done / wsTasks.length) * 100) : 0;

      lines.push(`## ${ws} — ${pct}% complete`);
      lines.push("");

      // Task list grouped by status
      const byStatus = new Map<string, NodeRecord[]>();
      for (const t of wsTasks) {
        const list = byStatus.get(t.status) ?? [];
        list.push(t);
        byStatus.set(t.status, list);
      }

      for (const [status, statusTasks] of byStatus) {
        lines.push(`### ${status}`);
        for (const t of statusTasks) {
          lines.push(`- ${t.name}${t.priority ? ` [${t.priority}]` : ""}`);
        }
        lines.push("");
      }

      // Blocked items
      const blocked = wsTasks.filter((t) => t.status === "blocked");
      if (blocked.length > 0) {
        lines.push("### Blocked Items");
        for (const t of blocked) {
          lines.push(`- ${t.name}: ${t.notes ?? "no details"}`);
        }
        lines.push("");
      }

      // Stale items
      const stale = wsTasks.filter(
        (t) => t.status !== "done" && t.status !== "cancelled" && t.updatedAt < sevenDaysAgo,
      );
      if (stale.length > 0) {
        lines.push("### Stale Items (no update in 7+ days)");
        for (const t of stale) {
          lines.push(`- ${t.name} (last updated: ${t.updatedAt.slice(0, 10)})`);
        }
        lines.push("");
      }
    }

    return lines.join("\n");
  }

  // format === "investor"
  const lines: string[] = ["# Project Status Report", ""];

  // Total budget
  let totalBudget = 0;
  for (const rootId of rootNodeIds) {
    totalBudget += computeRollup(rootId, budgetMap, childrenMap, rollupMemo);
  }
  lines.push(`**Total Budget**: $${totalBudget.toLocaleString("en-US")}`, "");

  // Summary table
  lines.push("| Workstream | Progress | Tasks | Done | Blocked |");
  lines.push("|---|---|---|---|---|");

  for (const [ws, wsTasks] of workstreamTasks) {
    const done = wsTasks.filter((t) => t.status === "done").length;
    const blocked = wsTasks.filter((t) => t.status === "blocked").length;
    const pct = wsTasks.length > 0 ? Math.round((done / wsTasks.length) * 100) : 0;
    lines.push(`| ${ws} | ${pct}% | ${wsTasks.length} | ${done} | ${blocked} |`);
  }
  lines.push("");

  // Blocked items across all workstreams
  const allBlocked = tasks.filter((t) => t.status === "blocked");
  if (allBlocked.length > 0) {
    lines.push("## Blocked Items");
    lines.push("");
    for (const t of allBlocked) {
      lines.push(`- **${t.name}** (${t.workstream ?? "unassigned"}): ${t.notes ?? "no details"}`);
    }
    lines.push("");
  }

  // Per-workstream budget rollup
  lines.push("## Budget by Workstream");
  lines.push("");
  lines.push("| Workstream | Budget |");
  lines.push("|---|---|");

  // Compute budget per workstream from root-level structural nodes
  const wsStructural = allNodes.filter(
    (n) => structuralIds.has(n.id) && !childNodeIds.has(n.id),
  );
  const wsBudgets = new Map<string, number>();
  for (const n of wsStructural) {
    const ws = n.workstream ?? n.name;
    const rollup = computeRollup(n.id, budgetMap, childrenMap, rollupMemo);
    wsBudgets.set(ws, (wsBudgets.get(ws) ?? 0) + rollup);
  }
  // Also add orphan leaf tasks not under any structural node
  for (const t of tasks) {
    if (!childNodeIds.has(t.id)) {
      const ws = t.workstream ?? "unassigned";
      const own = t.budget ?? 0;
      if (own > 0) {
        wsBudgets.set(ws, (wsBudgets.get(ws) ?? 0) + own);
      }
    }
  }

  for (const [ws, budget] of wsBudgets) {
    lines.push(`| ${ws} | $${budget.toLocaleString("en-US")} |`);
  }
  lines.push("");

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// 7. Audit Trail
// ---------------------------------------------------------------------------

export type AuditLogRecord = typeof auditLog.$inferSelect;

export function writeAuditEntry(
  db: Db,
  entry: {
    toolName: string;
    userId: string;
    requestSummary: string;
    affectedNodeIds: string[];
    changesJson: Record<string, unknown>;
    verificationResult?: string;
  },
): AuditLogRecord {
  const id = crypto.randomUUID();
  // Use SQLite format (space-separated) so gte() comparisons with the `since` filter work correctly
  const now = new Date().toISOString().replace("T", " ").replace(/\.\d+Z$/, "");

  db.insert(auditLog)
    .values({
      id,
      toolName: entry.toolName,
      userId: entry.userId,
      requestSummary: entry.requestSummary,
      affectedNodeIds: JSON.stringify(entry.affectedNodeIds),
      changesJson: JSON.stringify(entry.changesJson),
      verificationResult: entry.verificationResult ?? "pass",
      createdAt: now,
    })
    .run();

  return db.select().from(auditLog).where(eq(auditLog.id, id)).get()!;
}

export function queryAuditTrail(
  db: Db,
  filters?: {
    since?: string;
    tool_name?: string;
    user_id?: string;
    node_id?: string;
    limit?: number;
  },
): AuditLogRecord[] {
  const conditions: SQL[] = [];

  if (filters?.since) {
    const normalized = filters.since.replace("T", " ").replace(/\.\d+Z$/, "").replace("Z", "");
    conditions.push(gte(auditLog.createdAt, normalized));
  }
  if (filters?.tool_name) {
    conditions.push(eq(auditLog.toolName, filters.tool_name));
  }
  if (filters?.user_id) {
    conditions.push(eq(auditLog.userId, filters.user_id));
  }

  // For node_id filter: use SQLite LIKE to pre-filter before fetching rows, then apply limit
  // This prevents loading the entire table into memory just to filter by one field
  if (filters?.node_id) {
    const escaped = filters.node_id.replace(/[%_]/g, "\\$&");
    conditions.push(
      sql`${auditLog.affectedNodeIds} LIKE ${"%" + escaped + "%"} ESCAPE '\\'` as SQL,
    );
  }

  let query = db.select().from(auditLog);
  if (conditions.length > 0) {
    query = query.where(and(...conditions)) as typeof query;
  }

  const limit = filters?.limit ?? 50;
  const results = query.orderBy(auditLog.createdAt).all().reverse().slice(0, limit);
  return results;
}

// ---------------------------------------------------------------------------
// 8. Execute Plan
// ---------------------------------------------------------------------------

const executePlanOperationSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("update"),
    nodeId: z.string(),
    fields: updateNodeSchema,
  }),
  z.object({
    action: z.literal("create"),
    fields: createNodeSchema,
  }),
  z.object({
    action: z.literal("create_edge"),
    fields: createEdgeSchema,
  }),
]);

const executePlanSchema = z.object({
  operations: z.array(executePlanOperationSchema).min(1).max(50),
  verify: z.boolean().default(true),
});

export type ExecutePlanInput = z.infer<typeof executePlanSchema>;
export { executePlanSchema };

export interface PlanReceipt {
  index: number;
  action: string;
  status: "success" | "error";
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  newId?: string;
  error?: string;
}

export interface ExecutePlanResult {
  receipts: PlanReceipt[];
  verification: "pass" | "skipped" | "mismatch_rolled_back";
  auditId: string;
}

export function executePlan(
  db: Db,
  sqlite: import("better-sqlite3").Database,
  input: ExecutePlanInput,
  userId: string,
): ExecutePlanResult {
  const receipts: PlanReceipt[] = [];
  const createdNameToId = new Map<string, string>();
  const affectedNodeIds: string[] = [];
  const broadcastQueue: Array<{ type: string; payload: Record<string, unknown> }> = [];

  const run = sqlite.transaction(() => {
    for (let i = 0; i < input.operations.length; i++) {
      const op = input.operations[i]!;

      try {
        if (op.action === "update") {
          const before = db.select().from(nodes).where(eq(nodes.id, op.nodeId)).get();
          if (!before) {
            receipts.push({ index: i, action: "update", status: "error", error: "Node not found" });
            continue;
          }
          const after = updateNode(db, op.nodeId, op.fields, userId);
          affectedNodeIds.push(op.nodeId);
          broadcastQueue.push({ type: "node:updated", payload: after as unknown as Record<string, unknown> });
          receipts.push({
            index: i,
            action: "update",
            status: "success",
            before: before as unknown as Record<string, unknown>,
            after: after as unknown as Record<string, unknown>,
          });
        } else if (op.action === "create") {
          const node = createNode(db, op.fields, userId);
          createdNameToId.set(node.name, node.id);
          affectedNodeIds.push(node.id);
          broadcastQueue.push({ type: "node:created", payload: node as unknown as Record<string, unknown> });
          receipts.push({
            index: i,
            action: "create",
            status: "success",
            before: null,
            after: node as unknown as Record<string, unknown>,
            newId: node.id,
          });
        } else if (op.action === "create_edge") {
          let sourceId = op.fields.source_id;
          let targetId = op.fields.target_id;

          // Resolve names to IDs for nodes created earlier in this plan
          if (createdNameToId.has(sourceId)) sourceId = createdNameToId.get(sourceId)!;
          if (createdNameToId.has(targetId)) targetId = createdNameToId.get(targetId)!;

          const edgeResult = createEdge(db, { source_id: sourceId, target_id: targetId, type: op.fields.type }, userId);
          if ("error" in edgeResult) {
            receipts.push({ index: i, action: "create_edge", status: "error", error: edgeResult.error });
            continue;
          }
          affectedNodeIds.push(sourceId, targetId);
          broadcastQueue.push({ type: "edge:created", payload: edgeResult as unknown as Record<string, unknown> });
          receipts.push({
            index: i,
            action: "create_edge",
            status: "success",
            before: null,
            after: edgeResult as unknown as Record<string, unknown>,
          });
        }
      } catch (err) {
        receipts.push({ index: i, action: op.action, status: "error", error: String(err) });
      }
    }

    // Verification step
    if (input.verify) {
      for (const receipt of receipts) {
        if (receipt.status !== "success") continue;
        if (receipt.action === "update" || receipt.action === "create") {
          const nodeId = receipt.action === "create" ? receipt.newId! : (receipt.after as Record<string, unknown>)?.id as string;
          const current = db.select().from(nodes).where(eq(nodes.id, nodeId)).get();
          if (!current) {
            // Verification failed: node should exist but doesn't
            throw new Error(`VERIFICATION_MISMATCH: node ${nodeId} not found after write`);
          }
        }
      }
    }
  });

  // Execute the transaction (IMMEDIATE prevents interleaving of concurrent plans)
  let verification: "pass" | "skipped" | "mismatch_rolled_back" = input.verify ? "pass" : "skipped";
  try {
    run.immediate();
  } catch (err) {
    if (String(err).includes("VERIFICATION_MISMATCH")) {
      verification = "mismatch_rolled_back";
      // Write audit entry OUTSIDE the rolled-back transaction
      const auditEntry = writeAuditEntry(db, {
        toolName: "rome_execute_plan",
        userId,
        requestSummary: `Plan with ${input.operations.length} operations — ROLLED BACK (verification failure)`,
        affectedNodeIds: [],
        changesJson: { operations: input.operations, error: String(err) },
        verificationResult: "mismatch_rolled_back",
      });
      return { receipts: receipts.map(r => ({ ...r, status: "error" as const, error: r.error ?? "Rolled back due to verification failure" })), verification, auditId: auditEntry.id };
    }
    throw err;
  }

  // Write audit entry for successful execution
  const auditEntry = writeAuditEntry(db, {
    toolName: "rome_execute_plan",
    userId,
    requestSummary: `Plan with ${input.operations.length} operations — ${receipts.filter(r => r.status === "success").length} succeeded`,
    affectedNodeIds: [...new Set(affectedNodeIds)],
    changesJson: { receipts },
    verificationResult: verification,
  });

  return { receipts, verification, auditId: auditEntry.id, _broadcastQueue: broadcastQueue } as ExecutePlanResult & { _broadcastQueue: typeof broadcastQueue };
}
