import { describe, it, expect, beforeEach, afterEach } from "vitest";
import request from "supertest";
import { createTestContext, closeTestContext, createTestUser } from "./helpers.js";

let ctx: ReturnType<typeof createTestContext>;
let token: string;
let userId: string;

beforeEach(async () => {
  ctx = createTestContext();
  const user = await createTestUser(ctx.db, { role: "admin" });
  token = user.token;
  userId = user.id;
});

afterEach(() => closeTestContext(ctx));

describe("GET /api/graph", () => {
  it("returns empty graph", async () => {
    const res = await request(ctx.app)
      .get("/api/graph")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ nodes: [], edges: [] });
  });

  it("returns all nodes and edges", async () => {
    // Create two nodes
    const n1 = await request(ctx.app)
      .post("/api/nodes")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Node A" });
    const n2 = await request(ctx.app)
      .post("/api/nodes")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Node B" });

    // Create an edge
    await request(ctx.app)
      .post("/api/edges")
      .set("Authorization", `Bearer ${token}`)
      .send({ source_id: n1.body.id, target_id: n2.body.id, type: "blocks" });

    const res = await request(ctx.app)
      .get("/api/graph")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.nodes).toHaveLength(2);
    expect(res.body.edges).toHaveLength(1);
  });

  it("requires authentication", async () => {
    const res = await request(ctx.app).get("/api/graph");
    expect(res.status).toBe(401);
  });
});

describe("GET /api/budget", () => {
  it("returns empty workstreams for no nodes", async () => {
    const res = await request(ctx.app)
      .get("/api/budget")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.workstreams).toEqual([]);
  });

  it("returns budget for a single node", async () => {
    await request(ctx.app)
      .post("/api/nodes")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Task A", budget: 1000, workstream: "alpha" });

    const res = await request(ctx.app)
      .get("/api/budget")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.workstreams).toHaveLength(1);
    expect(res.body.workstreams[0].workstream).toBe("alpha");
    expect(res.body.workstreams[0].total).toBe(1000);
    expect(res.body.workstreams[0].nodes).toHaveLength(1);
    expect(res.body.workstreams[0].nodes[0].own).toBe(1000);
    expect(res.body.workstreams[0].nodes[0].rollup).toBe(1000);
  });

  it("rolls up parent budget from children", async () => {
    const parent = await request(ctx.app)
      .post("/api/nodes")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Parent", budget: 500, workstream: "alpha" });

    const child = await request(ctx.app)
      .post("/api/nodes")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Child", budget: 300, workstream: "alpha" });

    // parent_of: parent -> child
    await request(ctx.app)
      .post("/api/edges")
      .set("Authorization", `Bearer ${token}`)
      .send({ source_id: parent.body.id, target_id: child.body.id, type: "parent_of" });

    const res = await request(ctx.app)
      .get("/api/budget")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    const ws = res.body.workstreams[0];

    // Parent rollup = own (500) + child (300) = 800
    const parentNode = ws.nodes.find((n: any) => n.name === "Parent");
    expect(parentNode.own).toBe(500);
    expect(parentNode.rollup).toBe(800);

    // Child rollup = own (300)
    const childNode = ws.nodes.find((n: any) => n.name === "Child");
    expect(childNode.own).toBe(300);
    expect(childNode.rollup).toBe(300);

    // Workstream total only sums root nodes to avoid double-counting
    expect(ws.total).toBe(800);
  });

  it("avoids double-counting in workstream totals", async () => {
    const root = await request(ctx.app)
      .post("/api/nodes")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Root", budget: 100, workstream: "beta" });

    const childA = await request(ctx.app)
      .post("/api/nodes")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Child A", budget: 200, workstream: "beta" });

    const childB = await request(ctx.app)
      .post("/api/nodes")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Child B", budget: 300, workstream: "beta" });

    await request(ctx.app)
      .post("/api/edges")
      .set("Authorization", `Bearer ${token}`)
      .send({ source_id: root.body.id, target_id: childA.body.id, type: "parent_of" });

    await request(ctx.app)
      .post("/api/edges")
      .set("Authorization", `Bearer ${token}`)
      .send({ source_id: root.body.id, target_id: childB.body.id, type: "parent_of" });

    const res = await request(ctx.app)
      .get("/api/budget")
      .set("Authorization", `Bearer ${token}`);

    const ws = res.body.workstreams[0];

    // Root rollup = 100 + 200 + 300 = 600
    const rootNode = ws.nodes.find((n: any) => n.name === "Root");
    expect(rootNode.rollup).toBe(600);

    // Total only counts root node rollup
    expect(ws.total).toBe(600);
  });

  it("handles nodes without budget", async () => {
    await request(ctx.app)
      .post("/api/nodes")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "No Budget", workstream: "gamma" });

    const res = await request(ctx.app)
      .get("/api/budget")
      .set("Authorization", `Bearer ${token}`);

    const ws = res.body.workstreams[0];
    expect(ws.total).toBe(0);
    expect(ws.nodes[0].own).toBe(0);
    expect(ws.nodes[0].rollup).toBe(0);
  });

  it("groups unassigned nodes under 'unassigned'", async () => {
    await request(ctx.app)
      .post("/api/nodes")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Orphan", budget: 50 });

    const res = await request(ctx.app)
      .get("/api/budget")
      .set("Authorization", `Bearer ${token}`);

    expect(res.body.workstreams[0].workstream).toBe("unassigned");
    expect(res.body.workstreams[0].total).toBe(50);
  });

  it("requires authentication", async () => {
    const res = await request(ctx.app).get("/api/budget");
    expect(res.status).toBe(401);
  });
});
