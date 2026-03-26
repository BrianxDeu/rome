import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestContext, closeTestContext, createTestUser } from "./helpers.js";
import {
  createNode,
  updateNode,
  createEdge,
  getGraph,
  resolveNodeByName,
  generateStatusReport,
} from "../services.js";

// ---------------------------------------------------------------------------
// Shared setup — fresh in-memory DB per test
// ---------------------------------------------------------------------------

let ctx: ReturnType<typeof createTestContext>;
let userId: string;

beforeEach(async () => {
  ctx = createTestContext();
  const user = await createTestUser(ctx.db);
  userId = user.id;
});

afterEach(() => closeTestContext(ctx));

// ---------------------------------------------------------------------------
// Helper — quickly insert a node via the service layer
// ---------------------------------------------------------------------------

async function quickNode(
  name: string,
  opts: { workstream?: string; status?: "not_started" | "in_progress" | "blocked" | "done" | "cancelled"; priority?: "P0" | "P1" | "P2" | "P3"; budget?: number } = {},
) {
  return createNode(ctx.db, { name, ...opts }, userId);
}

// ---------------------------------------------------------------------------
// getGraph
// ---------------------------------------------------------------------------

describe("getGraph", () => {
  it("returns all nodes and edges with no filters", async () => {
    const a = await quickNode("Antenna calibration");
    const b = await quickNode("Sensor integration");
    await createEdge(ctx.db, { source_id: a.id, target_id: b.id, type: "blocks" }, userId);

    const graph = await getGraph(ctx.db);

    expect(graph.nodes).toHaveLength(2);
    expect(graph.edges).toHaveLength(1);
    expect(graph.nodes.map((n: any) => n.name).sort()).toEqual([
      "Antenna calibration",
      "Sensor integration",
    ]);
  });

  it("filters by workstream", async () => {
    await quickNode("HALO sensor test", { workstream: "HALO MVP" });
    await quickNode("Ukraine logistics", { workstream: "Ukraine Ops" });

    const graph = await getGraph(ctx.db, { workstream: "HALO MVP" });

    expect(graph.nodes).toHaveLength(1);
    expect(graph.nodes[0].name).toBe("HALO sensor test");
  });

  it("filters by status", async () => {
    await quickNode("Blocked task", { status: "blocked" });
    await quickNode("Done task", { status: "done" });
    await quickNode("In progress task", { status: "in_progress" });

    const graph = await getGraph(ctx.db, { status: "blocked" });

    expect(graph.nodes).toHaveLength(1);
    expect(graph.nodes[0].name).toBe("Blocked task");
  });

  it("AND semantics for multiple filters", async () => {
    await quickNode("HALO blocked", { workstream: "HALO MVP", status: "blocked" });
    await quickNode("HALO done", { workstream: "HALO MVP", status: "done" });
    await quickNode("Ukraine blocked", { workstream: "Ukraine Ops", status: "blocked" });

    const graph = await getGraph(ctx.db, { workstream: "HALO MVP", status: "blocked" });

    expect(graph.nodes).toHaveLength(1);
    expect(graph.nodes[0].name).toBe("HALO blocked");
  });

  it("returns empty for nonexistent workstream filter", async () => {
    await quickNode("Some task", { workstream: "HALO MVP" });

    const graph = await getGraph(ctx.db, { workstream: "NONEXISTENT" });

    expect(graph.nodes).toHaveLength(0);
    // Should not throw — empty results are valid for read filters
    expect(graph.edges).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// createNode
// ---------------------------------------------------------------------------

describe("createNode", () => {
  it("creates node with defaults", async () => {
    const node = await createNode(ctx.db, { name: "Hardware Tech Stack" }, userId);

    expect(node.id).toBeDefined();
    expect(node.name).toBe("Hardware Tech Stack");
    expect(node.status).toBe("not_started");
    expect(node.priority).toBe("P2");
  });

  it("creates node with all optional fields", async () => {
    const node = await createNode(
      ctx.db,
      {
        name: "Warhead Program",
        status: "in_progress",
        priority: "P0",
        budget: 250000,
        workstream: "HALO MVP",
      },
      userId,
    );

    expect(node.status).toBe("in_progress");
    expect(node.priority).toBe("P0");
    expect(node.budget).toBe(250000);
    expect(node.workstream).toBe("HALO MVP");
  });
});

// ---------------------------------------------------------------------------
// createEdge
// ---------------------------------------------------------------------------

describe("createEdge", () => {
  it("creates parent_of edge", async () => {
    const parent = await quickNode("HALO MVP");
    const child = await quickNode("Antenna calibration");

    const edge = await createEdge(
      ctx.db,
      { source_id: parent.id, target_id: child.id, type: "parent_of" },
      userId,
    );

    expect("id" in edge).toBe(true);
    if ("id" in edge) {
      expect(edge.type).toBe("parent_of");
    }
  });

  it("rejects second parent (MULTIPLE_PARENTS)", async () => {
    const parent1 = await quickNode("HALO MVP");
    const parent2 = await quickNode("ORCREST");
    const child = await quickNode("Shared task");

    await createEdge(
      ctx.db,
      { source_id: parent1.id, target_id: child.id, type: "parent_of" },
      userId,
    );

    const result = createEdge(
      ctx.db,
      { source_id: parent2.id, target_id: child.id, type: "parent_of" },
      userId,
    );

    expect("error" in result).toBe(true);
    if ("error" in result) {
      expect(result.code).toBe("MULTIPLE_PARENTS");
    }
  });
});

// ---------------------------------------------------------------------------
// resolveNodeByName
// ---------------------------------------------------------------------------

describe("resolveNodeByName", () => {
  it("unique match returns found", async () => {
    await quickNode("Ukraine Ops");

    const result = await resolveNodeByName(ctx.db, "Ukraine");

    expect(result.status).toBe("found");
    expect((result as any).node.name).toBe("Ukraine Ops");
  });

  it("ambiguous match returns candidates", async () => {
    await quickNode("Test Alpha");
    await quickNode("Test Beta");

    const result = await resolveNodeByName(ctx.db, "Test");

    expect(result.status).toBe("ambiguous");
    expect((result as any).candidates).toHaveLength(2);
    const names = (result as any).candidates.map((c: any) => c.name).sort();
    expect(names).toEqual(["Test Alpha", "Test Beta"]);
  });

  it("no match returns no_match", async () => {
    await quickNode("HALO MVP");

    const result = await resolveNodeByName(ctx.db, "NONEXISTENT");

    expect(result.status).toBe("no_match");
  });

  it("structural node returns not_a_task", async () => {
    // Create a parent (structural) node with a child linked by parent_of
    const parent = await quickNode("HALO MVP");
    const child = await quickNode("Antenna calibration");
    await createEdge(
      ctx.db,
      { source_id: parent.id, target_id: child.id, type: "parent_of" },
      userId,
    );

    const result = await resolveNodeByName(ctx.db, "HALO MVP");

    expect(result.status).toBe("not_a_task");
  });
});

// ---------------------------------------------------------------------------
// generateStatusReport
// ---------------------------------------------------------------------------

describe("generateStatusReport", () => {
  it("brief format returns markdown with workstream names and percentages", async () => {
    // Create nodes in different statuses under a workstream
    await quickNode("HALO sensor test", { workstream: "HALO MVP", status: "done" });
    await quickNode("HALO antenna cal", { workstream: "HALO MVP", status: "in_progress" });
    await quickNode("HALO power unit", { workstream: "HALO MVP", status: "not_started" });
    await quickNode("Ukraine logistics", { workstream: "Ukraine Ops", status: "blocked" });

    const report = await generateStatusReport(ctx.db, "brief");

    expect(typeof report).toBe("string");
    // Should contain workstream names
    expect(report).toContain("HALO MVP");
    expect(report).toContain("Ukraine Ops");
    // Should contain percentage indicators (e.g., "33%" or similar)
    expect(report).toMatch(/\d+%/);
  });

  it("investor format includes budget rollup", async () => {
    // Create a parent workstream and child tasks with budgets
    const ws = await quickNode("HALO MVP", { workstream: "HALO MVP" });
    const task1 = await quickNode("Antenna calibration", {
      workstream: "HALO MVP",
      budget: 50000,
      status: "in_progress",
    });
    const task2 = await quickNode("Sensor integration", {
      workstream: "HALO MVP",
      budget: 75000,
      status: "done",
    });

    // Link tasks under workstream
    await createEdge(ctx.db, { source_id: ws.id, target_id: task1.id, type: "parent_of" }, userId);
    await createEdge(ctx.db, { source_id: ws.id, target_id: task2.id, type: "parent_of" }, userId);

    const report = await generateStatusReport(ctx.db, "investor");

    expect(typeof report).toBe("string");
    // Should contain budget figures
    expect(report).toMatch(/\$?\d[\d,]*(?:\.\d{2})?/); // matches currency-like patterns
    expect(report).toContain("HALO MVP");
    // Should contain some budget total reference (50000 + 75000 = 125000)
    expect(report).toMatch(/125[,.]?000/);
  });
});
