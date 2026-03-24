import { Router } from "express";
import { eq, and } from "drizzle-orm";
import { z } from "zod";
import { edges, nodes } from "@rome/shared/schema";
import type { Db } from "../db.js";
import { broadcast } from "../socket.js";

const DEPENDENCY_TYPES = new Set(["blocks", "blocker", "depends_on", "sequence"]);

const createSchema = z.object({
  source_id: z.string(),
  target_id: z.string(),
  type: z.enum(["blocks", "blocker", "depends_on", "sequence", "produces", "feeds", "shared", "parent_of"]),
});

function toEdgeJson(edge: {
  id: string;
  sourceId: string;
  targetId: string;
  type: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}) {
  return {
    id: edge.id,
    source_id: edge.sourceId,
    target_id: edge.targetId,
    type: edge.type,
    created_by: edge.createdBy,
    created_at: edge.createdAt,
    updated_at: edge.updatedAt,
  };
}

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

export function edgeRoutes(db: Db): Router {
  const router = Router();

  router.post("/", (req, res) => {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid input", code: "VALIDATION_ERROR" });
      return;
    }

    const { source_id, target_id, type } = parsed.data;

    if (source_id === target_id) {
      res.status(422).json({ error: "Self-referencing edges are not allowed", code: "SELF_REFERENCE" });
      return;
    }

    const source = db.select().from(nodes).where(eq(nodes.id, source_id)).get();
    const target = db.select().from(nodes).where(eq(nodes.id, target_id)).get();
    if (!source || !target) {
      res.status(404).json({ error: "Node not found", code: "NOT_FOUND" });
      return;
    }

    if (DEPENDENCY_TYPES.has(type)) {
      if (wouldCreateCycle(db, source_id, target_id)) {
        res.status(422).json({ error: "Edge would create a cycle", code: "CYCLE_DETECTED" });
        return;
      }
    }

    if (type === "parent_of") {
      const existingParent = db
        .select()
        .from(edges)
        .where(and(eq(edges.targetId, target_id), eq(edges.type, "parent_of")))
        .get();

      if (existingParent) {
        res.status(422).json({ error: "Node already has a parent", code: "MULTIPLE_PARENTS" });
        return;
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
        createdBy: req.auth!.userId,
        createdAt: now,
        updatedAt: now,
      })
      .run();

    const edge = db.select().from(edges).where(eq(edges.id, id)).get()!;
    broadcast({ type: "edge:created", payload: edge as unknown as Record<string, unknown> });
    res.status(201).json(toEdgeJson(edge));
  });

  router.delete("/:id", (req, res) => {
    const existing = db.select().from(edges).where(eq(edges.id, req.params.id!)).get();
    if (!existing) {
      res.status(404).json({ error: "Edge not found", code: "NOT_FOUND" });
      return;
    }

    db.delete(edges).where(eq(edges.id, req.params.id!)).run();
    broadcast({ type: "edge:deleted", payload: { id: req.params.id! } });
    res.status(204).send();
  });

  return router;
}
