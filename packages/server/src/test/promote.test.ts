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

describe("Promote task: full sequence", () => {
  it("creates a node under a node group and removes the personal task", async () => {
    // 1. Create a workstream header (no parent, no workstream field)
    const wsRes = await request(ctx.app)
      .post("/api/nodes")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "cUAS Program" });
    expect(wsRes.status).toBe(201);
    const wsHeaderId = wsRes.body.id;

    // 2. Create a node group under the workstream header
    const ngRes = await request(ctx.app)
      .post("/api/nodes")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Counter-Measures", workstream: "cUAS Program" });
    expect(ngRes.status).toBe(201);
    const nodeGroupId = ngRes.body.id;

    // 3. Wire up node group under workstream header (parent_of + produces)
    const parentEdge = await request(ctx.app)
      .post("/api/edges")
      .set("Authorization", `Bearer ${token}`)
      .send({ source_id: wsHeaderId, target_id: nodeGroupId, type: "parent_of" });
    expect(parentEdge.status).toBe(201);
    const producesEdge = await request(ctx.app)
      .post("/api/edges")
      .set("Authorization", `Bearer ${token}`)
      .send({ source_id: nodeGroupId, target_id: wsHeaderId, type: "produces" });
    expect(producesEdge.status).toBe(201);

    // 4. Create a personal task
    const taskRes = await request(ctx.app)
      .post("/api/tasks")
      .set("Authorization", `Bearer ${token}`)
      .send({ text: "GPS spoofing countermeasure research", priority: "P1" });
    expect(taskRes.status).toBe(201);
    const taskId = taskRes.body.id;

    // --- PROMOTE SEQUENCE ---

    // 5. Create the graph node from the task
    const newNodeRes = await request(ctx.app)
      .post("/api/nodes")
      .set("Authorization", `Bearer ${token}`)
      .send({
        name: "GPS spoofing countermeasure research",
        workstream: "cUAS Program",
        status: "not_started",
        priority: "P1",
      });
    expect(newNodeRes.status).toBe(201);
    const newNodeId = newNodeRes.body.id;
    expect(newNodeRes.body.name).toBe("GPS spoofing countermeasure research");
    expect(newNodeRes.body.workstream).toBe("cUAS Program");
    expect(newNodeRes.body.status).toBe("not_started");
    expect(newNodeRes.body.priority).toBe("P1");

    // 6. Create parent_of edge: nodeGroup → newNode
    const parentOfRes = await request(ctx.app)
      .post("/api/edges")
      .set("Authorization", `Bearer ${token}`)
      .send({ source_id: nodeGroupId, target_id: newNodeId, type: "parent_of" });
    expect(parentOfRes.status).toBe(201);
    expect(parentOfRes.body.type).toBe("parent_of");

    // 7. Create produces edge: newNode → nodeGroup
    const producesRes = await request(ctx.app)
      .post("/api/edges")
      .set("Authorization", `Bearer ${token}`)
      .send({ source_id: newNodeId, target_id: nodeGroupId, type: "produces" });
    expect(producesRes.status).toBe(201);
    expect(producesRes.body.type).toBe("produces");

    // 8. Delete the personal task
    const deleteRes = await request(ctx.app)
      .delete(`/api/tasks/${taskId}`)
      .set("Authorization", `Bearer ${token}`);
    expect(deleteRes.status).toBe(204);

    // 9. Verify task is gone
    const tasksRes = await request(ctx.app)
      .get("/api/tasks")
      .set("Authorization", `Bearer ${token}`);
    expect(tasksRes.status).toBe(200);
    expect(tasksRes.body.find((t: { id: string }) => t.id === taskId)).toBeUndefined();

    // 10. Verify the graph contains the new node connected to the node group
    const graphRes = await request(ctx.app)
      .get("/api/graph")
      .set("Authorization", `Bearer ${token}`);
    expect(graphRes.status).toBe(200);
    const graphNode = graphRes.body.nodes.find((n: { id: string }) => n.id === newNodeId);
    expect(graphNode).toBeDefined();
    // /api/graph returns raw Drizzle ORM camelCase (sourceId/targetId), unlike /api/edges which uses toEdgeJson() snake_case
    const graphEdges = graphRes.body.edges;
    const hasParentOf = graphEdges.some(
      (e: { sourceId: string; targetId: string; type: string }) =>
        e.sourceId === nodeGroupId && e.targetId === newNodeId && e.type === "parent_of"
    );
    const hasProduces = graphEdges.some(
      (e: { sourceId: string; targetId: string; type: string }) =>
        e.sourceId === newNodeId && e.targetId === nodeGroupId && e.type === "produces"
    );
    expect(hasParentOf).toBe(true);
    expect(hasProduces).toBe(true);
  });

  it("rejects creating parent_of edge when node already has a parent", async () => {
    // Create two node groups and a leaf node parented to the first
    const ng1Res = await request(ctx.app)
      .post("/api/nodes")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Group A", workstream: "WS" });
    expect(ng1Res.status).toBe(201);
    const ng2Res = await request(ctx.app)
      .post("/api/nodes")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Group B", workstream: "WS" });
    expect(ng2Res.status).toBe(201);
    const leafRes = await request(ctx.app)
      .post("/api/nodes")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "My Task", workstream: "WS" });
    expect(leafRes.status).toBe(201);

    // Parent leaf under Group A
    await request(ctx.app)
      .post("/api/edges")
      .set("Authorization", `Bearer ${token}`)
      .send({ source_id: ng1Res.body.id, target_id: leafRes.body.id, type: "parent_of" });

    // Attempt to also parent leaf under Group B — should fail
    const dupRes = await request(ctx.app)
      .post("/api/edges")
      .set("Authorization", `Bearer ${token}`)
      .send({ source_id: ng2Res.body.id, target_id: leafRes.body.id, type: "parent_of" });
    expect(dupRes.status).toBe(422);
    expect(dupRes.body.code).toBe("MULTIPLE_PARENTS");
  });
});
