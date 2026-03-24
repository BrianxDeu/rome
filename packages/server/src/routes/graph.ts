import { Router } from "express";
import { eq, and } from "drizzle-orm";
import { nodes, edges } from "@rome/shared/schema";
import type { Db } from "../db.js";

export function graphRoutes(db: Db): Router {
  const router = Router();

  router.get("/", (_req, res) => {
    const allNodes = db.select().from(nodes).all();
    const allEdges = db.select().from(edges).all();
    res.json({ nodes: allNodes, edges: allEdges });
  });

  return router;
}

interface BudgetNode {
  id: string;
  name: string;
  workstream: string | null;
  budget: number | null;
}

interface NodeRollup {
  id: string;
  name: string;
  own: number;
  rollup: number;
}

interface WorkstreamRollup {
  workstream: string;
  total: number;
  nodes: NodeRollup[];
}

function buildParentMap(db: Db): Map<string, string[]> {
  // parent_of: sourceId is parent, targetId is child
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

function findParent(db: Db, nodeId: string): string | null {
  const parentEdge = db
    .select()
    .from(edges)
    .where(and(eq(edges.targetId, nodeId), eq(edges.type, "parent_of")))
    .get();
  return parentEdge?.sourceId ?? null;
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

export function budgetRoutes(db: Db): Router {
  const router = Router();

  router.get("/", (_req, res) => {
    const allNodes = db.select().from(nodes).all();
    const childrenMap = buildParentMap(db);

    const budgetMap = new Map<string, number>();
    for (const n of allNodes) {
      if (n.budget != null) budgetMap.set(n.id, n.budget);
    }

    // Find root nodes (no parent) for each node
    const rootNodes = new Set<string>();
    for (const n of allNodes) {
      if (findParent(db, n.id) === null) {
        rootNodes.add(n.id);
      }
    }

    const memo = new Map<string, number>();

    // Build per-node rollups
    const nodeRollups = new Map<string, NodeRollup>();
    for (const n of allNodes) {
      const own = budgetMap.get(n.id) ?? 0;
      const rollup = computeRollup(n.id, budgetMap, childrenMap, memo);
      nodeRollups.set(n.id, { id: n.id, name: n.name, own, rollup });
    }

    // Group by workstream, only sum root nodes to avoid double-counting
    const workstreamMap = new Map<string, { total: number; nodes: NodeRollup[] }>();

    for (const n of allNodes) {
      const ws = n.workstream ?? "unassigned";
      if (!workstreamMap.has(ws)) {
        workstreamMap.set(ws, { total: 0, nodes: [] });
      }
      const entry = workstreamMap.get(ws)!;
      entry.nodes.push(nodeRollups.get(n.id)!);

      // Only add root node rollups to workstream total to avoid double-counting
      if (rootNodes.has(n.id)) {
        entry.total += nodeRollups.get(n.id)!.rollup;
      }
    }

    const workstreams: WorkstreamRollup[] = [];
    for (const [ws, data] of workstreamMap) {
      workstreams.push({ workstream: ws, total: data.total, nodes: data.nodes });
    }

    res.json({ workstreams });
  });

  return router;
}
