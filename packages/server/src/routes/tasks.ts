import { Router } from "express";
import { eq, and, asc, desc } from "drizzle-orm";
import { z } from "zod";
import { personalTasks } from "@rome/shared/schema";
import type { Db } from "../db.js";
import { broadcastToUser } from "../socket.js";

const createSchema = z.object({
  text: z.string().min(1).max(1000),
  priority: z.enum(["P0", "P1", "P2", "P3"]).default("P1"),
});

const toggleSchema = z.object({
  done: z.boolean(),
});

export function taskRoutes(db: Db): Router {
  const router = Router();

  router.get("/", (req, res) => {
    const userId = req.auth!.userId;
    const result = db
      .select()
      .from(personalTasks)
      .where(eq(personalTasks.userId, userId))
      .orderBy(
        asc(personalTasks.done),
        asc(personalTasks.priority),
        desc(personalTasks.createdAt),
      )
      .all();
    res.json(result);
  });

  router.post("/", (req, res) => {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid input", code: "VALIDATION_ERROR" });
      return;
    }

    const id = crypto.randomUUID();
    const now = new Date().toISOString().replace("T", " ").replace(/\.\d+Z$/, "");
    const userId = req.auth!.userId;
    const data = parsed.data;

    try {
      db.insert(personalTasks)
        .values({
          id,
          userId,
          text: data.text,
          priority: data.priority,
          done: 0,
          doneAt: null,
          createdAt: now,
        })
        .run();
    } catch (err) {
      console.error("[POST /tasks] insert failed:", err);
      res.status(500).json({ error: "Failed to create task" });
      return;
    }

    const task = db.select().from(personalTasks).where(eq(personalTasks.id, id)).get();
    broadcastToUser(userId, { type: "task:created", payload: task as unknown as Record<string, unknown> });
    res.status(201).json(task);
  });

  router.patch("/:id", (req, res) => {
    const parsed = toggleSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid input", code: "VALIDATION_ERROR" });
      return;
    }

    const userId = req.auth!.userId;
    const existing = db
      .select()
      .from(personalTasks)
      .where(and(eq(personalTasks.id, req.params.id!), eq(personalTasks.userId, userId)))
      .get();

    if (!existing) {
      res.status(404).json({ error: "Task not found", code: "NOT_FOUND" });
      return;
    }

    const done = parsed.data.done;
    const doneAt = done ? new Date().toISOString().replace("T", " ").replace(/\.\d+Z$/, "") : null;

    db.update(personalTasks)
      .set({ done: done ? 1 : 0, doneAt })
      .where(and(eq(personalTasks.id, req.params.id!), eq(personalTasks.userId, userId)))
      .run();

    const updated = db.select().from(personalTasks).where(eq(personalTasks.id, req.params.id!)).get();
    broadcastToUser(userId, { type: "task:updated", payload: updated as unknown as Record<string, unknown> });
    res.json(updated);
  });

  router.delete("/:id", (req, res) => {
    const userId = req.auth!.userId;
    const existing = db
      .select()
      .from(personalTasks)
      .where(and(eq(personalTasks.id, req.params.id!), eq(personalTasks.userId, userId)))
      .get();

    if (!existing) {
      res.status(404).json({ error: "Task not found", code: "NOT_FOUND" });
      return;
    }

    db.delete(personalTasks)
      .where(and(eq(personalTasks.id, req.params.id!), eq(personalTasks.userId, userId)))
      .run();

    broadcastToUser(userId, { type: "task:deleted", payload: { id: req.params.id! } });
    res.status(204).send();
  });

  return router;
}
