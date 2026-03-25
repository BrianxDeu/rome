import { Router } from "express";
import { eq, and, type SQL } from "drizzle-orm";
import { z } from "zod";
import { nodes, edges, users } from "@rome/shared/schema";
import type { Db } from "../db.js";
import { broadcast } from "../socket.js";

/** Ensure the authenticated user exists in the local DB (handles cross-env tokens) */
function ensureUser(db: Db, userId: string) {
  const existing = db.select().from(users).where(eq(users.id, userId)).get();
  if (!existing) {
    const now = new Date().toISOString();
    db.insert(users).values({
      id: userId,
      username: `user-${userId.slice(0, 8)}`,
      email: `${userId.slice(0, 8)}@local`,
      passwordHash: "",
      role: "member",
      createdAt: now,
      updatedAt: now,
    }).run();
  }
}

const createSchema = z.object({
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

const updateSchema = createSchema.partial().omit({ name: true }).extend({
  name: z.string().min(1).optional(),
});

export function nodeRoutes(db: Db): Router {
  const router = Router();

  router.get("/", (req, res) => {
    const { workstream, status, priority } = req.query;

    const conditions: SQL[] = [];
    if (workstream) conditions.push(eq(nodes.workstream, workstream as string));
    if (status) conditions.push(eq(nodes.status, status as string));
    if (priority) conditions.push(eq(nodes.priority, priority as string));

    let query = db.select().from(nodes);
    if (conditions.length > 0) {
      query = query.where(and(...conditions)) as typeof query;
    }

    const result = query.all();
    res.json(result);
  });

  router.get("/:id", (req, res) => {
    const node = db.select().from(nodes).where(eq(nodes.id, req.params.id!)).get();

    if (!node) {
      res.status(404).json({ error: "Node not found", code: "NOT_FOUND" });
      return;
    }

    const nodeEdges = db
      .select()
      .from(edges)
      .where(
        eq(edges.sourceId, req.params.id!)
      )
      .all()
      .concat(
        db
          .select()
          .from(edges)
          .where(eq(edges.targetId, req.params.id!))
          .all()
      );

    // Deduplicate edges (in case source === target, though self-ref is rejected)
    const seen = new Set<string>();
    const uniqueEdges = nodeEdges.filter((e) => {
      if (seen.has(e.id)) return false;
      seen.add(e.id);
      return true;
    });

    res.json({ ...node, edges: uniqueEdges });
  });

  router.post("/", (req, res) => {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid input", code: "VALIDATION_ERROR" });
      return;
    }

    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const data = parsed.data;

    ensureUser(db, req.auth!.userId);

    try {
      db.insert(nodes)
        .values({
          id,
          name: data.name,
          status: data.status ?? "not_started",
          priority: data.priority ?? "P2",
          startDate: data.start_date ?? null,
          endDate: data.end_date ?? null,
          budget: data.budget ?? null,
          deliverable: data.deliverable ?? null,
          notes: data.notes ?? null,
          raci: data.raci ? (typeof data.raci === "string" ? data.raci : JSON.stringify(data.raci)) : null,
          workstream: data.workstream ?? null,
          x: data.x ?? null,
          y: data.y ?? null,
          positionPinned: data.position_pinned ? 1 : 0,
          attachments: data.attachments ? (typeof data.attachments === "string" ? data.attachments : JSON.stringify(data.attachments)) : null,
          createdBy: req.auth!.userId,
          createdAt: now,
          updatedAt: now,
        })
        .run();
    } catch (err) {
      console.error("[POST /nodes] insert failed:", err);
      res.status(500).json({ error: "Failed to create node" });
      return;
    }

    const node = db.select().from(nodes).where(eq(nodes.id, id)).get();
    broadcast({ type: "node:created", payload: node as unknown as Record<string, unknown> });
    res.status(201).json(node);
  });

  router.patch("/:id", (req, res) => {
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid input", code: "VALIDATION_ERROR" });
      return;
    }

    const existing = db.select().from(nodes).where(eq(nodes.id, req.params.id!)).get();
    if (!existing) {
      res.status(404).json({ error: "Node not found", code: "NOT_FOUND" });
      return;
    }

    const data = parsed.data;
    const changes: Record<string, unknown> = { updatedAt: new Date().toISOString() };

    if (data.name !== undefined) changes.name = data.name;
    if (data.status !== undefined) changes.status = data.status;
    if (data.priority !== undefined) changes.priority = data.priority;
    if (data.start_date !== undefined) changes.startDate = data.start_date;
    if (data.end_date !== undefined) changes.endDate = data.end_date;
    if (data.budget !== undefined) changes.budget = data.budget;
    if (data.deliverable !== undefined) changes.deliverable = data.deliverable;
    if (data.notes !== undefined) changes.notes = data.notes;
    if (data.raci !== undefined) changes.raci = data.raci ? (typeof data.raci === "string" ? data.raci : JSON.stringify(data.raci)) : null;
    if (data.workstream !== undefined) changes.workstream = data.workstream;
    if (data.x !== undefined) changes.x = data.x;
    if (data.y !== undefined) changes.y = data.y;
    if (data.position_pinned !== undefined) changes.positionPinned = data.position_pinned ? 1 : 0;
    if (data.attachments !== undefined) changes.attachments = data.attachments ? (typeof data.attachments === "string" ? data.attachments : JSON.stringify(data.attachments)) : null;

    db.update(nodes).set(changes).where(eq(nodes.id, req.params.id!)).run();
    const updated = db.select().from(nodes).where(eq(nodes.id, req.params.id!)).get();

    broadcast({ type: "node:updated", payload: updated as unknown as Record<string, unknown> });
    res.json(updated);
  });

  router.delete("/:id", (req, res) => {
    const existing = db.select().from(nodes).where(eq(nodes.id, req.params.id!)).get();
    if (!existing) {
      res.status(404).json({ error: "Node not found", code: "NOT_FOUND" });
      return;
    }

    // Edges are cascade-deleted via ON DELETE CASCADE in the schema
    db.delete(nodes).where(eq(nodes.id, req.params.id!)).run();
    broadcast({ type: "node:deleted", payload: { id: req.params.id! } });
    res.status(204).send();
  });

  return router;
}
