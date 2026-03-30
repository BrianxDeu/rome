import { Router } from "express";
import { eq, isNotNull, isNull, and } from "drizzle-orm";
import { nodes, edges } from "@rome/shared/schema";
import type { Db } from "../db.js";
import { broadcast } from "../socket.js";

/** Collect all descendant node IDs of a given node via parent_of edges (sourceId=parent, targetId=child) */
function getDescendantIds(db: Db, rootId: string): string[] {
  const result: string[] = [];
  const queue = [rootId];

  while (queue.length > 0) {
    const current = queue.shift()!;
    const children = db
      .select({ id: edges.targetId })
      .from(edges)
      .where(and(eq(edges.sourceId, current), eq(edges.type, "parent_of")))
      .all();

    for (const child of children) {
      result.push(child.id);
      queue.push(child.id);
    }
  }

  return result;
}

/** Find workstream header nodes: no parent_of edge pointing to them, no workstream field set */
function getWorkstreamHeaders(db: Db): Array<typeof nodes.$inferSelect> {
  const allNodes = db.select().from(nodes).where(isNull(nodes.archivedAt)).all();
  const childIds = new Set(
    db.select({ id: edges.targetId })
      .from(edges)
      .where(eq(edges.type, "parent_of"))
      .all()
      .map((e) => e.id)
  );

  return allNodes.filter((n) => !childIds.has(n.id) && !n.workstream);
}

const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

export function archiveRoutes(db: Db): Router {
  const router = Router();

  // POST /api/archive/check — lazy archive on mount
  router.post("/check", (_req, res) => {
    const headers = getWorkstreamHeaders(db);
    let archivedCount = 0;
    const now = new Date().toISOString().replace("T", " ").replace(/\.\d+Z$/, "");

    for (const header of headers) {
      const descendantIds = getDescendantIds(db, header.id);

      // Skip headers with no descendants
      if (descendantIds.length === 0) continue;

      // Check if all descendants are done
      const descendants = descendantIds.map((id) =>
        db.select().from(nodes).where(eq(nodes.id, id)).get()
      ).filter(Boolean) as Array<typeof nodes.$inferSelect>;

      const allDone = descendants.every((n) => n.status === "done");
      if (!allDone) continue;

      // Check 24h grace period: max completedAt across all descendants
      const completedAts = descendants
        .map((n) => n.completedAt)
        .filter(Boolean) as string[];

      if (completedAts.length > 0) {
        const maxCompletedAt = completedAts.sort().pop()!;
        const elapsed = Date.now() - new Date(maxCompletedAt.replace(" ", "T") + "Z").getTime();
        if (elapsed < TWENTY_FOUR_HOURS_MS) continue;
      }
      // If no completedAt values (pre-migration nodes), treat as "completed long ago" — archive immediately

      // Archive the entire workstream tree
      const allIds = [header.id, ...descendantIds];
      for (const id of allIds) {
        db.update(nodes).set({ archivedAt: now }).where(eq(nodes.id, id)).run();
      }
      archivedCount++;
    }

    if (archivedCount > 0) {
      broadcast({ type: "graph:refetch" as any, payload: {} });
    }

    res.json({ archived: archivedCount });
  });

  // GET /api/archive — list archived nodes and edges
  router.get("/", (_req, res) => {
    const archivedNodes = db.select().from(nodes).where(isNotNull(nodes.archivedAt)).all();

    if (archivedNodes.length === 0) {
      res.json({ nodes: [], edges: [] });
      return;
    }

    const archivedIds = new Set(archivedNodes.map((n) => n.id));
    const allEdges = db.select().from(edges).all();
    const archivedEdges = allEdges.filter(
      (e) => archivedIds.has(e.sourceId) || archivedIds.has(e.targetId)
    );

    res.json({ nodes: archivedNodes, edges: archivedEdges });
  });

  // POST /api/archive/:workstreamId/restore — unarchive a workstream
  router.post("/:workstreamId/restore", (req, res) => {
    const { workstreamId } = req.params;

    const header = db.select().from(nodes).where(eq(nodes.id, workstreamId!)).get();
    if (!header) {
      res.status(404).json({ error: "Workstream not found" });
      return;
    }

    if (!header.archivedAt) {
      res.status(400).json({ error: "Workstream is not archived" });
      return;
    }

    const descendantIds = getDescendantIds(db, workstreamId!);
    const allIds = [workstreamId!, ...descendantIds];

    for (const id of allIds) {
      db.update(nodes).set({ archivedAt: null }).where(eq(nodes.id, id)).run();
    }

    broadcast({ type: "graph:refetch" as any, payload: {} });

    const restoredNodes = allIds.map((id) =>
      db.select().from(nodes).where(eq(nodes.id, id)).get()
    ).filter(Boolean);

    res.json({ restored: restoredNodes });
  });

  return router;
}
