import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type BetterSqlite3 from "better-sqlite3";
import { createTestContext, closeTestContext, createTestUser } from "./helpers.js";
import {
  createNode,
  updateNode,
  createEdge,
  executePlan,
  executePlanSchema,
  writeAuditEntry,
  queryAuditTrail,
} from "../services.js";
import type { NodeRecord, EdgeRecord } from "../services.js";
import { nodes, edges } from "@rome/shared/schema";
import { eq } from "drizzle-orm";

let ctx: ReturnType<typeof createTestContext>;
let userId: string;
let token: string;

// Seed data references
let haloId: string;
let cuasId: string;
let sensorGroupId: string;
let flightGroupId: string;
let calibrateId: string;
let testFlightId: string;
let budgetReviewId: string;

beforeAll(async () => {
  ctx = createTestContext();
  const user = await createTestUser(ctx.db);
  userId = user.id;
  token = user.token;

  // Create workstream headers
  const halo = createNode(ctx.db, { name: "HALO" }, userId);
  haloId = halo.id;
  const cuas = createNode(ctx.db, { name: "cUAS" }, userId);
  cuasId = cuas.id;

  // Create node groups under HALO
  const sensorGroup = createNode(ctx.db, { name: "Sensor Integration", workstream: "HALO" }, userId);
  sensorGroupId = sensorGroup.id;
  const flightGroup = createNode(ctx.db, { name: "Flight Testing", workstream: "HALO" }, userId);
  flightGroupId = flightGroup.id;

  // Create leaf nodes
  const calibrate = createNode(ctx.db, { name: "Calibrate Sensors", workstream: "HALO" }, userId);
  calibrateId = calibrate.id;
  const testFlight = createNode(ctx.db, { name: "Test Flight Protocol", workstream: "HALO" }, userId);
  testFlightId = testFlight.id;
  const budgetReview = createNode(ctx.db, { name: "Budget Review", workstream: "cUAS" }, userId);
  budgetReviewId = budgetReview.id;

  // parent_of edges: HALO -> groups -> leaves
  createEdge(ctx.db, { source_id: haloId, target_id: sensorGroupId, type: "parent_of" }, userId);
  createEdge(ctx.db, { source_id: haloId, target_id: flightGroupId, type: "parent_of" }, userId);
  createEdge(ctx.db, { source_id: sensorGroupId, target_id: calibrateId, type: "parent_of" }, userId);
  createEdge(ctx.db, { source_id: flightGroupId, target_id: testFlightId, type: "parent_of" }, userId);
  createEdge(ctx.db, { source_id: cuasId, target_id: budgetReviewId, type: "parent_of" }, userId);
});

afterAll(() => closeTestContext(ctx));

// =========================================================================
// rome_execute_plan
// =========================================================================
describe("rome_execute_plan", () => {
  // -----------------------------------------------------------------------
  // happy path
  // -----------------------------------------------------------------------
  describe("happy path", () => {
    it("single update — updates a leaf node status with before/after receipt", () => {
      const result = executePlan(ctx.db, ctx.sqlite, {
        operations: [
          { action: "update", nodeId: calibrateId, fields: { status: "in_progress" } },
        ],
        verify: true,
      }, userId);

      expect(result.receipts).toHaveLength(1);
      const receipt = result.receipts[0]!;
      expect(receipt.status).toBe("success");
      expect(receipt.action).toBe("update");
      expect(receipt.before).toBeDefined();
      expect(receipt.after).toBeDefined();
      expect((receipt.before as Record<string, unknown>).status).toBe("not_started");
      expect((receipt.after as Record<string, unknown>).status).toBe("in_progress");
    });

    it("single create — creates a new node with newId in receipt", () => {
      const result = executePlan(ctx.db, ctx.sqlite, {
        operations: [
          { action: "create", fields: { name: "New Task Alpha" } },
        ],
        verify: true,
      }, userId);

      expect(result.receipts).toHaveLength(1);
      const receipt = result.receipts[0]!;
      expect(receipt.status).toBe("success");
      expect(receipt.action).toBe("create");
      expect(receipt.newId).toBeDefined();
      expect(typeof receipt.newId).toBe("string");

      // Verify node exists in DB
      const node = ctx.db.select().from(nodes).where(eq(nodes.id, receipt.newId!)).get();
      expect(node).toBeDefined();
      expect(node!.name).toBe("New Task Alpha");
    });

    it("single create_edge — creates an edge with success receipt", () => {
      // Create two fresh nodes for this test
      const n1 = createNode(ctx.db, { name: "Edge Source Node" }, userId);
      const n2 = createNode(ctx.db, { name: "Edge Target Node" }, userId);

      const result = executePlan(ctx.db, ctx.sqlite, {
        operations: [
          { action: "create_edge", fields: { source_id: n1.id, target_id: n2.id, type: "blocks" } },
        ],
        verify: true,
      }, userId);

      expect(result.receipts).toHaveLength(1);
      expect(result.receipts[0]!.status).toBe("success");
      expect(result.receipts[0]!.action).toBe("create_edge");
    });

    it("mixed operations — create + update + create_edge all succeed", () => {
      const result = executePlan(ctx.db, ctx.sqlite, {
        operations: [
          { action: "create", fields: { name: "Mixed Op Task" } },
          { action: "update", nodeId: testFlightId, fields: { priority: "P0" } },
          { action: "create_edge", fields: { source_id: calibrateId, target_id: testFlightId, type: "blocks" } },
        ],
        verify: true,
      }, userId);

      expect(result.receipts).toHaveLength(3);
      expect(result.receipts.every(r => r.status === "success")).toBe(true);
      expect(result.receipts[0]!.action).toBe("create");
      expect(result.receipts[1]!.action).toBe("update");
      expect(result.receipts[2]!.action).toBe("create_edge");
    });
  });

  // -----------------------------------------------------------------------
  // cross-references
  // -----------------------------------------------------------------------
  describe("cross-references", () => {
    it("create node then create_edge referencing it by name", () => {
      const result = executePlan(ctx.db, ctx.sqlite, {
        operations: [
          { action: "create", fields: { name: "Cross Ref Task" } },
          { action: "create_edge", fields: { source_id: "Cross Ref Task", target_id: budgetReviewId, type: "depends_on" } },
        ],
        verify: true,
      }, userId);

      expect(result.receipts).toHaveLength(2);
      expect(result.receipts[0]!.status).toBe("success");
      expect(result.receipts[1]!.status).toBe("success");

      // Verify the edge was created with the actual ID, not the name
      const edgeAfter = result.receipts[1]!.after as Record<string, unknown>;
      expect(edgeAfter.sourceId).not.toBe("Cross Ref Task");
      expect(edgeAfter.sourceId).toBe(result.receipts[0]!.newId);
    });

    it("create two nodes, edge between them by name", () => {
      const result = executePlan(ctx.db, ctx.sqlite, {
        operations: [
          { action: "create", fields: { name: "Alpha Node" } },
          { action: "create", fields: { name: "Beta Node" } },
          { action: "create_edge", fields: { source_id: "Alpha Node", target_id: "Beta Node", type: "sequence" } },
        ],
        verify: true,
      }, userId);

      expect(result.receipts).toHaveLength(3);
      expect(result.receipts.every(r => r.status === "success")).toBe(true);

      const edgeAfter = result.receipts[2]!.after as Record<string, unknown>;
      expect(edgeAfter.sourceId).toBe(result.receipts[0]!.newId);
      expect(edgeAfter.targetId).toBe(result.receipts[1]!.newId);
    });
  });

  // -----------------------------------------------------------------------
  // error handling
  // -----------------------------------------------------------------------
  describe("error handling", () => {
    it("update with nonexistent nodeId — that op errors, others succeed", () => {
      const result = executePlan(ctx.db, ctx.sqlite, {
        operations: [
          { action: "update", nodeId: "nonexistent-id-12345", fields: { status: "done" } },
          { action: "create", fields: { name: "Should Still Succeed" } },
        ],
        verify: true,
      }, userId);

      expect(result.receipts).toHaveLength(2);
      expect(result.receipts[0]!.status).toBe("error");
      expect(result.receipts[0]!.error).toContain("not found");
      expect(result.receipts[1]!.status).toBe("success");
    });

    it("create with missing name — Zod rejects", () => {
      expect(() => {
        executePlanSchema.parse({
          operations: [
            { action: "create", fields: {} },
          ],
          verify: true,
        });
      }).toThrow();
    });

    it("operations array > 50 — Zod rejects", () => {
      const ops = Array.from({ length: 51 }, (_, i) => ({
        action: "create" as const,
        fields: { name: `Task ${i}` },
      }));

      expect(() => {
        executePlanSchema.parse({ operations: ops, verify: true });
      }).toThrow();
    });

    it("empty operations array — Zod rejects .min(1)", () => {
      expect(() => {
        executePlanSchema.parse({ operations: [], verify: true });
      }).toThrow();
    });
  });

  // -----------------------------------------------------------------------
  // verification
  // -----------------------------------------------------------------------
  describe("verification", () => {
    it("normal verification passes — verification is 'pass'", () => {
      const result = executePlan(ctx.db, ctx.sqlite, {
        operations: [
          { action: "create", fields: { name: "Verified Task" } },
        ],
        verify: true,
      }, userId);

      expect(result.verification).toBe("pass");
    });

    it("verify: false — skips verification", () => {
      const result = executePlan(ctx.db, ctx.sqlite, {
        operations: [
          { action: "create", fields: { name: "Unverified Task" } },
        ],
        verify: false,
      }, userId);

      expect(result.verification).toBe("skipped");
    });
  });

  // -----------------------------------------------------------------------
  // broadcasting
  // -----------------------------------------------------------------------
  describe("broadcasting", () => {
    it("_broadcastQueue is populated after successful executePlan", () => {
      const result = executePlan(ctx.db, ctx.sqlite, {
        operations: [
          { action: "create", fields: { name: "Broadcast Test Node" } },
          { action: "update", nodeId: budgetReviewId, fields: { status: "in_progress" } },
        ],
        verify: true,
      }, userId) as ReturnType<typeof executePlan> & { _broadcastQueue: unknown[] };

      expect(result._broadcastQueue).toBeDefined();
      expect(Array.isArray(result._broadcastQueue)).toBe(true);
      expect(result._broadcastQueue.length).toBeGreaterThanOrEqual(2);
    });
  });
});

// =========================================================================
// rome_audit_trail
// =========================================================================
describe("rome_audit_trail", () => {
  // -----------------------------------------------------------------------
  // writeAuditEntry
  // -----------------------------------------------------------------------
  describe("writeAuditEntry", () => {
    it("writes an entry and reads it back", () => {
      const entry = writeAuditEntry(ctx.db, {
        toolName: "rome_test_tool",
        userId,
        requestSummary: "Test write audit entry",
        affectedNodeIds: [calibrateId],
        changesJson: { foo: "bar" },
      });

      expect(entry).toBeDefined();
      expect(entry.id).toBeDefined();
      expect(entry.toolName).toBe("rome_test_tool");
    });

    it("stores all fields correctly", () => {
      const entry = writeAuditEntry(ctx.db, {
        toolName: "rome_custom_tool",
        userId,
        requestSummary: "Detailed audit test",
        affectedNodeIds: [calibrateId, testFlightId],
        changesJson: { updated: true, count: 2 },
        verificationResult: "pass",
      });

      expect(entry.toolName).toBe("rome_custom_tool");
      expect(entry.userId).toBe(userId);
      expect(entry.requestSummary).toBe("Detailed audit test");
      expect(JSON.parse(entry.affectedNodeIds)).toEqual([calibrateId, testFlightId]);
      expect(JSON.parse(entry.changesJson)).toEqual({ updated: true, count: 2 });
      expect(entry.verificationResult).toBe("pass");
      expect(entry.createdAt).toBeDefined();
    });
  });

  // -----------------------------------------------------------------------
  // queryAuditTrail
  // -----------------------------------------------------------------------
  describe("queryAuditTrail", () => {
    // Write some entries for query tests
    let auditEntryA: ReturnType<typeof writeAuditEntry>;
    let auditEntryB: ReturnType<typeof writeAuditEntry>;
    let auditEntryC: ReturnType<typeof writeAuditEntry>;
    let secondUserId: string;

    beforeAll(async () => {
      const user2 = await createTestUser(ctx.db, { username: "audituser2", email: "audit2@test.com" });
      secondUserId = user2.id;

      auditEntryA = writeAuditEntry(ctx.db, {
        toolName: "rome_execute_plan",
        userId,
        requestSummary: "Plan A",
        affectedNodeIds: [calibrateId],
        changesJson: { plan: "A" },
      });

      auditEntryB = writeAuditEntry(ctx.db, {
        toolName: "rome_update_node",
        userId: secondUserId,
        requestSummary: "Update B",
        affectedNodeIds: [testFlightId],
        changesJson: { plan: "B" },
      });

      auditEntryC = writeAuditEntry(ctx.db, {
        toolName: "rome_execute_plan",
        userId,
        requestSummary: "Plan C",
        affectedNodeIds: [calibrateId, budgetReviewId],
        changesJson: { plan: "C" },
      });
    });

    it("no filters — returns entries ordered by created_at DESC", () => {
      const results = queryAuditTrail(ctx.db);
      expect(results.length).toBeGreaterThanOrEqual(3);
      // Check descending order
      for (let i = 1; i < results.length; i++) {
        expect(results[i - 1]!.createdAt >= results[i]!.createdAt).toBe(true);
      }
    });

    it("filter by tool_name", () => {
      const results = queryAuditTrail(ctx.db, { tool_name: "rome_update_node" });
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results.every(r => r.toolName === "rome_update_node")).toBe(true);
    });

    it("filter by user_id", () => {
      const results = queryAuditTrail(ctx.db, { user_id: secondUserId });
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results.every(r => r.userId === secondUserId)).toBe(true);
    });

    it("filter by node_id (checks JSON array contains)", () => {
      const results = queryAuditTrail(ctx.db, { node_id: calibrateId });
      expect(results.length).toBeGreaterThanOrEqual(2);
      for (const entry of results) {
        const ids = JSON.parse(entry.affectedNodeIds) as string[];
        expect(ids).toContain(calibrateId);
      }
    });

    it("filter by since (timestamp)", () => {
      // All entries should be after epoch
      const results = queryAuditTrail(ctx.db, { since: "2020-01-01T00:00:00Z" });
      expect(results.length).toBeGreaterThanOrEqual(3);

      // Using a far-future date should return nothing
      const futureResults = queryAuditTrail(ctx.db, { since: "2099-01-01T00:00:00Z" });
      expect(futureResults).toHaveLength(0);
    });

    it("combined filters (AND semantics)", () => {
      const results = queryAuditTrail(ctx.db, {
        tool_name: "rome_execute_plan",
        user_id: userId,
      });
      expect(results.length).toBeGreaterThanOrEqual(2);
      expect(results.every(r => r.toolName === "rome_execute_plan" && r.userId === userId)).toBe(true);
    });

    it("limit parameter", () => {
      const results = queryAuditTrail(ctx.db, { limit: 1 });
      expect(results).toHaveLength(1);
    });
  });
});

// =========================================================================
// existing tool audit logging
// =========================================================================
describe("existing tool audit logging", () => {
  it("executePlan creates audit entries — verify entry exists", () => {
    const result = executePlan(ctx.db, ctx.sqlite, {
      operations: [
        { action: "create", fields: { name: "Audit Logged Task" } },
      ],
      verify: true,
    }, userId);

    expect(result.auditId).toBeDefined();

    // Query the audit trail and find the entry
    const entries = queryAuditTrail(ctx.db, { tool_name: "rome_execute_plan" });
    const match = entries.find(e => e.id === result.auditId);
    expect(match).toBeDefined();
    expect(match!.requestSummary).toContain("1 operations");
    expect(match!.requestSummary).toContain("1 succeeded");
  });

  it("multiple executePlan calls create separate audit entries", () => {
    const result1 = executePlan(ctx.db, ctx.sqlite, {
      operations: [{ action: "create", fields: { name: "Multi Audit 1" } }],
      verify: true,
    }, userId);

    const result2 = executePlan(ctx.db, ctx.sqlite, {
      operations: [{ action: "create", fields: { name: "Multi Audit 2" } }],
      verify: true,
    }, userId);

    expect(result1.auditId).not.toBe(result2.auditId);

    const entries = queryAuditTrail(ctx.db, { tool_name: "rome_execute_plan" });
    const ids = entries.map(e => e.id);
    expect(ids).toContain(result1.auditId);
    expect(ids).toContain(result2.auditId);
  });
});

// =========================================================================
// integration
// =========================================================================
describe("integration", () => {
  it("full workflow: create nodes via executePlan, query audit trail, verify changes recorded", () => {
    // Step 1: Create nodes and edge via executePlan
    const result = executePlan(ctx.db, ctx.sqlite, {
      operations: [
        { action: "create", fields: { name: "Integration Node A", workstream: "HALO" } },
        { action: "create", fields: { name: "Integration Node B", workstream: "HALO" } },
        { action: "create_edge", fields: { source_id: "Integration Node A", target_id: "Integration Node B", type: "parent_of" } },
      ],
      verify: true,
    }, userId);

    expect(result.verification).toBe("pass");
    expect(result.receipts).toHaveLength(3);
    expect(result.receipts.every(r => r.status === "success")).toBe(true);

    const nodeAId = result.receipts[0]!.newId!;
    const nodeBId = result.receipts[1]!.newId!;

    // Step 2: Query audit trail for the plan
    const auditEntries = queryAuditTrail(ctx.db, { tool_name: "rome_execute_plan" });
    const planEntry = auditEntries.find(e => e.id === result.auditId);
    expect(planEntry).toBeDefined();

    // Step 3: Verify affected node IDs include both created nodes
    const affectedIds = JSON.parse(planEntry!.affectedNodeIds) as string[];
    expect(affectedIds).toContain(nodeAId);
    expect(affectedIds).toContain(nodeBId);

    // Step 4: Verify the changes JSON contains receipts
    const changesJson = JSON.parse(planEntry!.changesJson) as { receipts: unknown[] };
    expect(changesJson.receipts).toHaveLength(3);

    // Step 5: Query audit by node_id and confirm it appears
    const nodeAudit = queryAuditTrail(ctx.db, { node_id: nodeAId });
    expect(nodeAudit.length).toBeGreaterThanOrEqual(1);
    expect(nodeAudit.some(e => e.id === result.auditId)).toBe(true);
  });
});
