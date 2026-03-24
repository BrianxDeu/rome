import { describe, it, expect, beforeEach, afterEach } from "vitest";
import request from "supertest";
import { createTestContext, closeTestContext, createTestUser } from "./helpers.js";

let ctx: ReturnType<typeof createTestContext>;
let token: string;

beforeEach(async () => {
  ctx = createTestContext();
  const user = await createTestUser(ctx.db, { role: "admin" });
  token = user.token;
});

afterEach(() => {
  closeTestContext(ctx);
});

async function createNode(app: any, authToken: string, name: string) {
  const res = await request(app).post("/api/nodes").set("Authorization", `Bearer ${authToken}`).send({ name });
  return res.body;
}

describe("POST /api/edges", () => {
  it("creates a blocks edge", async () => {
    const a = await createNode(ctx.app, token, "A");
    const b = await createNode(ctx.app, token, "B");

    const res = await request(ctx.app)
      .post("/api/edges")
      .set("Authorization", `Bearer ${token}`)
      .send({ source_id: a.id, target_id: b.id, type: "blocks" });

    expect(res.status).toBe(201);
    expect(res.body.source_id).toBe(a.id);
    expect(res.body.target_id).toBe(b.id);
    expect(res.body.type).toBe("blocks");
  });

  it("creates a parent_of edge", async () => {
    const parent = await createNode(ctx.app, token, "Goal");
    const child = await createNode(ctx.app, token, "Sub-task");

    const res = await request(ctx.app)
      .post("/api/edges")
      .set("Authorization", `Bearer ${token}`)
      .send({ source_id: parent.id, target_id: child.id, type: "parent_of" });

    expect(res.status).toBe(201);
    expect(res.body.type).toBe("parent_of");
  });

  it("rejects self-referencing edge", async () => {
    const a = await createNode(ctx.app, token, "A");

    const res = await request(ctx.app)
      .post("/api/edges")
      .set("Authorization", `Bearer ${token}`)
      .send({ source_id: a.id, target_id: a.id, type: "blocks" });

    expect(res.status).toBe(422);
    expect(res.body.code).toBe("SELF_REFERENCE");
  });

  it("rejects cycle in blocks edges (A->B->C->A)", async () => {
    const a = await createNode(ctx.app, token, "A");
    const b = await createNode(ctx.app, token, "B");
    const c = await createNode(ctx.app, token, "C");

    await request(ctx.app).post("/api/edges").set("Authorization", `Bearer ${token}`)
      .send({ source_id: a.id, target_id: b.id, type: "blocks" });
    await request(ctx.app).post("/api/edges").set("Authorization", `Bearer ${token}`)
      .send({ source_id: b.id, target_id: c.id, type: "blocks" });

    const res = await request(ctx.app).post("/api/edges").set("Authorization", `Bearer ${token}`)
      .send({ source_id: c.id, target_id: a.id, type: "blocks" });

    expect(res.status).toBe(422);
    expect(res.body.code).toBe("CYCLE_DETECTED");
  });

  it("rejects second parent for same child", async () => {
    const parent1 = await createNode(ctx.app, token, "Parent 1");
    const parent2 = await createNode(ctx.app, token, "Parent 2");
    const child = await createNode(ctx.app, token, "Child");

    await request(ctx.app).post("/api/edges").set("Authorization", `Bearer ${token}`)
      .send({ source_id: parent1.id, target_id: child.id, type: "parent_of" });

    const res = await request(ctx.app).post("/api/edges").set("Authorization", `Bearer ${token}`)
      .send({ source_id: parent2.id, target_id: child.id, type: "parent_of" });

    expect(res.status).toBe(422);
    expect(res.body.code).toBe("MULTIPLE_PARENTS");
  });

  it("rejects edge with nonexistent node", async () => {
    const a = await createNode(ctx.app, token, "A");

    const res = await request(ctx.app)
      .post("/api/edges")
      .set("Authorization", `Bearer ${token}`)
      .send({ source_id: a.id, target_id: "nonexistent", type: "blocks" });

    expect(res.status).toBe(404);
  });
});

describe("Edge immutability", () => {
  it("has no PATCH endpoint for edges (type is immutable per spec)", async () => {
    const a = await createNode(ctx.app, token, "A");
    const b = await createNode(ctx.app, token, "B");

    const create = await request(ctx.app).post("/api/edges").set("Authorization", `Bearer ${token}`)
      .send({ source_id: a.id, target_id: b.id, type: "blocks" });

    const res = await request(ctx.app).patch(`/api/edges/${create.body.id}`).set("Authorization", `Bearer ${token}`)
      .send({ type: "parent_of" });

    expect([404, 405]).toContain(res.status);
  });
});

describe("DELETE /api/edges/:id", () => {
  it("deletes an edge", async () => {
    const a = await createNode(ctx.app, token, "A");
    const b = await createNode(ctx.app, token, "B");

    const create = await request(ctx.app).post("/api/edges").set("Authorization", `Bearer ${token}`)
      .send({ source_id: a.id, target_id: b.id, type: "blocks" });

    const res = await request(ctx.app).delete(`/api/edges/${create.body.id}`).set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(204);
  });
});
