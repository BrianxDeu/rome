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

describe("POST /api/nodes", () => {
  it("creates a node with just a name", async () => {
    const res = await request(ctx.app)
      .post("/api/nodes")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Sensor integration" });

    expect(res.status).toBe(201);
    expect(res.body.name).toBe("Sensor integration");
    expect(res.body.status).toBe("not_started");
    expect(res.body.priority).toBe("P2");
    expect(res.body.id).toBeDefined();
  });

  it("creates a node with all optional fields", async () => {
    const res = await request(ctx.app)
      .post("/api/nodes")
      .set("Authorization", `Bearer ${token}`)
      .send({
        name: "Halo MVP",
        status: "in_progress",
        priority: "P0",
        budget: 100000,
        workstream: "Halo",
        deliverable: "Working prototype",
      });

    expect(res.status).toBe(201);
    expect(res.body.priority).toBe("P0");
    expect(res.body.budget).toBe(100000);
    expect(res.body.workstream).toBe("Halo");
  });

  it("rejects missing name", async () => {
    const res = await request(ctx.app)
      .post("/api/nodes")
      .set("Authorization", `Bearer ${token}`)
      .send({});

    expect(res.status).toBe(400);
  });

  it("rejects unauthenticated requests", async () => {
    const res = await request(ctx.app)
      .post("/api/nodes")
      .send({ name: "Test" });

    expect(res.status).toBe(401);
  });
});

describe("GET /api/nodes", () => {
  it("lists all nodes", async () => {
    await request(ctx.app).post("/api/nodes").set("Authorization", `Bearer ${token}`).send({ name: "A" });
    await request(ctx.app).post("/api/nodes").set("Authorization", `Bearer ${token}`).send({ name: "B" });

    const res = await request(ctx.app).get("/api/nodes").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
  });

  it("filters by workstream", async () => {
    await request(ctx.app).post("/api/nodes").set("Authorization", `Bearer ${token}`).send({ name: "A", workstream: "Halo" });
    await request(ctx.app).post("/api/nodes").set("Authorization", `Bearer ${token}`).send({ name: "B", workstream: "Orcrest" });

    const res = await request(ctx.app).get("/api/nodes?workstream=Halo").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].name).toBe("A");
  });

  it("filters by status and priority", async () => {
    await request(ctx.app).post("/api/nodes").set("Authorization", `Bearer ${token}`).send({ name: "A", status: "blocked", priority: "P0" });
    await request(ctx.app).post("/api/nodes").set("Authorization", `Bearer ${token}`).send({ name: "B", status: "done", priority: "P1" });

    const res = await request(ctx.app).get("/api/nodes?status=blocked").set("Authorization", `Bearer ${token}`);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].name).toBe("A");
  });
});

describe("GET /api/nodes/:id", () => {
  it("returns node with its edges", async () => {
    const a = await request(ctx.app).post("/api/nodes").set("Authorization", `Bearer ${token}`).send({ name: "A" });
    const b = await request(ctx.app).post("/api/nodes").set("Authorization", `Bearer ${token}`).send({ name: "B" });
    await request(ctx.app)
      .post("/api/edges")
      .set("Authorization", `Bearer ${token}`)
      .send({ source_id: a.body.id, target_id: b.body.id, type: "blocks" });

    const res = await request(ctx.app).get(`/api/nodes/${a.body.id}`).set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.name).toBe("A");
    expect(res.body.edges).toHaveLength(1);
    expect(res.body.edges[0].type).toBe("blocks");
  });

  it("returns 404 for unknown id", async () => {
    const res = await request(ctx.app).get("/api/nodes/nonexistent").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(404);
  });
});

describe("PATCH /api/nodes/:id", () => {
  it("updates partial fields", async () => {
    const create = await request(ctx.app).post("/api/nodes").set("Authorization", `Bearer ${token}`).send({ name: "A" });

    const res = await request(ctx.app)
      .patch(`/api/nodes/${create.body.id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ status: "in_progress", budget: 50000 });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("in_progress");
    expect(res.body.budget).toBe(50000);
    expect(res.body.name).toBe("A");
  });
});

describe("DELETE /api/nodes/:id", () => {
  it("deletes node and returns 204", async () => {
    const create = await request(ctx.app).post("/api/nodes").set("Authorization", `Bearer ${token}`).send({ name: "A" });
    const res = await request(ctx.app).delete(`/api/nodes/${create.body.id}`).set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(204);

    const get = await request(ctx.app).get(`/api/nodes/${create.body.id}`).set("Authorization", `Bearer ${token}`);
    expect(get.status).toBe(404);
  });

  it("orphans children when parent is deleted (does not cascade delete child nodes)", async () => {
    const parent = await request(ctx.app).post("/api/nodes").set("Authorization", `Bearer ${token}`).send({ name: "Parent" });
    const child = await request(ctx.app).post("/api/nodes").set("Authorization", `Bearer ${token}`).send({ name: "Child" });
    await request(ctx.app)
      .post("/api/edges")
      .set("Authorization", `Bearer ${token}`)
      .send({ source_id: parent.body.id, target_id: child.body.id, type: "parent_of" });

    await request(ctx.app).delete(`/api/nodes/${parent.body.id}`).set("Authorization", `Bearer ${token}`);

    const childGet = await request(ctx.app).get(`/api/nodes/${child.body.id}`).set("Authorization", `Bearer ${token}`);
    expect(childGet.status).toBe(200);
    expect(childGet.body.name).toBe("Child");
    expect(childGet.body.edges).toHaveLength(0);
  });
});
