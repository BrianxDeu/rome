# Promote Task to Node Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "↗ promote" button to each personal task row that lets the user pick a workstream + node group and converts the task into a proper graph node.

**Architecture:** Pure client-side orchestration — no new server endpoints. TasksView reads workstream/node-group structure from the existing `useGraphStore` (already populated by Shell.tsx's `useGraph()` call), then fires three sequential API calls (POST node → POST parent_of edge → POST produces edge) followed by DELETE task. A brief toast confirms success.

**Tech Stack:** React 19, Zustand (`useGraphStore`), existing `api()` helper, existing `/api/nodes` + `/api/edges` + `/api/tasks` endpoints.

---

## File Structure

| Action | File | Change |
|--------|------|--------|
| Create | `packages/server/src/test/promote.test.ts` | Integration test for the full promote sequence |
| Modify | `packages/client/src/pages/TasksView.tsx` | All UI + logic changes — promote button, flyout, promoteTask function, toast |

No CSS file changes — inline styles throughout to keep it self-contained.

---

### Task 1: Write integration test for the promote sequence

The promote feature calls existing APIs in sequence. This test documents and validates that the full sequence works end-to-end.

**Files:**
- Create: `packages/server/src/test/promote.test.ts`

- [ ] **Step 1: Write the integration test**

```typescript
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
    const graphEdges = graphRes.body.edges;
    const hasParentOf = graphEdges.some(
      (e: { source_id: string; target_id: string; type: string }) =>
        e.source_id === nodeGroupId && e.target_id === newNodeId && e.type === "parent_of"
    );
    const hasProduces = graphEdges.some(
      (e: { source_id: string; target_id: string; type: string }) =>
        e.source_id === newNodeId && e.target_id === nodeGroupId && e.type === "produces"
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
    const ng2Res = await request(ctx.app)
      .post("/api/nodes")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Group B", workstream: "WS" });
    const leafRes = await request(ctx.app)
      .post("/api/nodes")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "My Task", workstream: "WS" });

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
```

- [ ] **Step 2: Run the tests**

```bash
npm run test --workspace=packages/server
```

Expected: All tests pass (no new server code needed — tests exercise existing endpoints).

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/test/promote.test.ts
git commit -m "test: integration test for promote-task sequence"
```

---

### Task 2: Add graphStore reads and workstream structure to TasksView

This task adds the data plumbing only — no UI changes yet. All new code goes into `packages/client/src/pages/TasksView.tsx`.

**Files:**
- Modify: `packages/client/src/pages/TasksView.tsx`

- [ ] **Step 1: Update imports at the top of TasksView.tsx**

Replace the existing imports block (lines 1–6) with:

```tsx
import { useState, useEffect, useRef, useMemo } from "react";
import { io } from "socket.io-client";
import { useAuthStore } from "../stores/authStore";
import { useGraphStore } from "../stores/graphStore";
import { api } from "../api";
import { buildClusterMaps } from "../constants";
import type { PersonalTask } from "@rome/shared";
import type { Node } from "@rome/shared";
```

- [ ] **Step 2: Add graphStore reads and structure derivation inside the TasksView function body, right after the existing `const token = ...` line**

```tsx
  // --- Graph structure for promote flyout ---
  const graphNodes = useGraphStore((s) => s.nodes);
  const graphEdges = useGraphStore((s) => s.edges);

  const { parentMap: graphParentMap, childrenMap: graphChildrenMap } = useMemo(
    () => buildClusterMaps(graphEdges),
    [graphEdges]
  );

  // Workstream headers: top-level nodes with no parent and no workstream field
  const wsHeaders = useMemo(
    () =>
      graphNodes
        .filter((n) => !graphParentMap.has(n.id) && !n.workstream && !n.archivedAt)
        .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0)),
    [graphNodes, graphParentMap]
  );

  // Returns node groups (direct children of a workstream header) for a given ws name
  function nodeGroupsForWs(wsName: string): Node[] {
    const wsHeader = wsHeaders.find((h) => h.name === wsName);
    if (!wsHeader) return [];
    return (graphChildrenMap.get(wsHeader.id) ?? [])
      .map((id) => graphNodes.find((n) => n.id === id))
      .filter((n): n is Node => !!n && !n.archivedAt)
      .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  }
```

- [ ] **Step 3: Typecheck**

```bash
npm run build --workspace=packages/shared && npx tsc --noEmit -p packages/client/tsconfig.json
```

Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add packages/client/src/pages/TasksView.tsx
git commit -m "feat: read workstream structure from graphStore in TasksView"
```

---

### Task 3: Add promote button, flyout, action, and toast

This task adds all the UI: the promote button on each task row, the two-panel flyout (workstream → node group), the `promoteTask` async function, and the confirmation toast.

**Files:**
- Modify: `packages/client/src/pages/TasksView.tsx`

- [ ] **Step 1: Add promote state variables and the flyout ref, right after the existing `timersRef` and `knownIdsRef` declarations**

```tsx
  const [promotingTaskId, setPromotingTaskId] = useState<string | null>(null);
  const [hoveringWs, setHoveringWs] = useState<string | null>(null);
  const [promoteToast, setPromoteToast] = useState<string | null>(null);
  const flyoutRef = useRef<HTMLDivElement>(null);
```

- [ ] **Step 2: Add the outside-click effect to close the flyout, right after the existing cleanup `useEffect` (the one that clears timers on unmount)**

```tsx
  // Close promote flyout on outside click
  useEffect(() => {
    if (!promotingTaskId) return;
    function handleClick(e: MouseEvent) {
      if (flyoutRef.current && !flyoutRef.current.contains(e.target as HTMLElement)) {
        setPromotingTaskId(null);
        setHoveringWs(null);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [promotingTaskId]);
```

- [ ] **Step 3: Add the `promoteTask` function, right after the `toggleDone` function**

```tsx
  async function promoteTask(task: PersonalTask, wsName: string, nodeGroupId: string) {
    setPromotingTaskId(null);
    setHoveringWs(null);
    try {
      // 1. Create the graph node
      const newNode = await api<Node>("/nodes", {
        method: "POST",
        body: JSON.stringify({
          name: task.text,
          workstream: wsName,
          status: "not_started",
          priority: task.priority,
        }),
      });

      // 2. parent_of edge: nodeGroup → newNode
      await api("/edges", {
        method: "POST",
        body: JSON.stringify({
          source_id: nodeGroupId,
          target_id: newNode.id,
          type: "parent_of",
        }),
      });

      // 3. produces edge: newNode → nodeGroup
      await api("/edges", {
        method: "POST",
        body: JSON.stringify({
          source_id: newNode.id,
          target_id: nodeGroupId,
          type: "produces",
        }),
      });

      // 4. Delete the personal task
      await api(`/tasks/${task.id}`, { method: "DELETE" });

      // 5. Remove from local task state
      clearDeleteTimer(task.id);
      setTasks((prev) => prev.filter((t) => t.id !== task.id));

      // 6. Show confirmation toast
      const ng = graphNodes.find((n) => n.id === nodeGroupId);
      setPromoteToast(`✓ Added to ${wsName} › ${ng?.name ?? ""}`);
      setTimeout(() => setPromoteToast(null), 3000);
    } catch (err) {
      console.error("Failed to promote task:", err);
    }
  }
```

- [ ] **Step 4: Add the toast banner to the JSX, right after the "My Tasks" header row `<div>` (before the add row div)**

Find this block in the return statement:
```tsx
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
        <div style={{ fontSize: 22, fontWeight: 300, color: "#414042", letterSpacing: 1 }}>My Tasks</div>
        <div style={{ fontSize: 11, color: "#999", letterSpacing: 0.5 }}>{dateStr}</div>
      </div>
```

Add the toast immediately after it:
```tsx
      {promoteToast && (
        <div style={{
          marginBottom: 12, padding: "8px 14px", background: "#FEF2F2", border: "1px solid #FECACA",
          borderRadius: 6, fontSize: 12, color: "#B81917", fontWeight: 500,
        }}>
          {promoteToast}
        </div>
      )}
```

- [ ] **Step 5: Wrap each task row's priority chip in a `position: relative` container and add the promote button + flyout**

Find the priority chip `<div>` inside the `sorted.map` block:
```tsx
              <div
                style={{
                  fontSize: 10, fontWeight: 700, letterSpacing: 0.3, padding: "2px 6px", borderRadius: 4,
                  color: PRIORITY_COLORS[t.priority] || "#999",
                  background: t.priority === "P0" ? "#F0F0F0" : t.priority === "P1" ? "#FFF0F0" : t.priority === "P2" ? "#F0F6FF" : "#F8F8F8",
                }}
              >
                {t.priority}
              </div>
```

Replace it with the priority chip + promote button + flyout wrapped in a position:relative container:
```tsx
              {/* Priority chip + promote button */}
              <div style={{ position: "relative", display: "flex", alignItems: "center", gap: 6 }}>
                <div
                  style={{
                    fontSize: 10, fontWeight: 700, letterSpacing: 0.3, padding: "2px 6px", borderRadius: 4,
                    color: PRIORITY_COLORS[t.priority] || "#999",
                    background: t.priority === "P0" ? "#F0F0F0" : t.priority === "P1" ? "#FFF0F0" : t.priority === "P2" ? "#F0F6FF" : "#F8F8F8",
                  }}
                >
                  {t.priority}
                </div>

                {!t.done && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setPromotingTaskId(promotingTaskId === t.id ? null : t.id);
                      setHoveringWs(null);
                    }}
                    style={{
                      display: "flex", alignItems: "center", gap: 3, padding: "2px 7px",
                      border: `1px solid ${promotingTaskId === t.id ? "#B81917" : "#E0E0E0"}`,
                      borderRadius: 4, fontSize: 10, cursor: "pointer", fontFamily: "inherit",
                      color: promotingTaskId === t.id ? "#B81917" : "#888",
                      background: promotingTaskId === t.id ? "#FFF0F0" : "#FAFAFA",
                    }}
                    title="Promote to project node"
                  >
                    ↗ promote
                  </button>
                )}

                {/* Promote flyout */}
                {promotingTaskId === t.id && (
                  <div
                    ref={flyoutRef}
                    style={{
                      position: "absolute", top: "calc(100% + 4px)", right: 0, zIndex: 200,
                      display: "flex", background: "#fff",
                      border: "1px solid #E0E0E0", borderRadius: 6,
                      boxShadow: "0 4px 16px rgba(0,0,0,0.12)", overflow: "hidden",
                      minWidth: 180,
                    }}
                  >
                    {/* Workstream list */}
                    <div style={{ minWidth: 180, borderRight: hoveringWs ? "1px solid #F0F0F0" : "none" }}>
                      <div style={{
                        padding: "7px 12px", fontSize: 10, fontWeight: 600,
                        letterSpacing: 1.5, textTransform: "uppercase", color: "#999",
                        borderBottom: "1px solid #F0F0F0",
                      }}>
                        Move to workstream
                      </div>
                      {wsHeaders.length === 0 ? (
                        <div style={{ padding: "10px 14px", fontSize: 12, color: "#C0C0C0" }}>
                          No workstreams
                        </div>
                      ) : (
                        wsHeaders.map((ws) => (
                          <div
                            key={ws.id}
                            onMouseEnter={() => setHoveringWs(ws.name)}
                            style={{
                              padding: "8px 14px", fontSize: 12, cursor: "pointer",
                              display: "flex", alignItems: "center", justifyContent: "space-between",
                              background: hoveringWs === ws.name ? "#FEF2F2" : "transparent",
                              color: hoveringWs === ws.name ? "#B81917" : "#414042",
                              fontWeight: hoveringWs === ws.name ? 600 : 400,
                            }}
                          >
                            {ws.name}
                            <span style={{ fontSize: 10, color: hoveringWs === ws.name ? "#B81917" : "#C0C0C0" }}>▸</span>
                          </div>
                        ))
                      )}
                    </div>

                    {/* Node group submenu */}
                    {hoveringWs && (
                      <div style={{ minWidth: 160 }}>
                        <div style={{
                          padding: "7px 12px", fontSize: 10, fontWeight: 600,
                          letterSpacing: 1.5, textTransform: "uppercase", color: "#999",
                          borderBottom: "1px solid #F0F0F0",
                        }}>
                          Node group
                        </div>
                        {nodeGroupsForWs(hoveringWs).length === 0 ? (
                          <div style={{ padding: "10px 14px", fontSize: 12, color: "#C0C0C0" }}>
                            No groups
                          </div>
                        ) : (
                          nodeGroupsForWs(hoveringWs).map((ng) => (
                            <div
                              key={ng.id}
                              onClick={() => promoteTask(t, hoveringWs, ng.id)}
                              style={{
                                padding: "8px 14px", fontSize: 12, cursor: "pointer", color: "#414042",
                              }}
                              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "#FEF2F2"; (e.currentTarget as HTMLElement).style.color = "#B81917"; }}
                              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; (e.currentTarget as HTMLElement).style.color = "#414042"; }}
                            >
                              {ng.name}
                            </div>
                          ))
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
```

- [ ] **Step 6: Typecheck**

```bash
npm run build --workspace=packages/shared && npx tsc --noEmit -p packages/client/tsconfig.json
```

Expected: No errors.

- [ ] **Step 7: Run server tests to confirm nothing broke**

```bash
npm run test --workspace=packages/server
```

Expected: All tests pass.

- [ ] **Step 8: Manual smoke test**

1. Open `http://localhost:5173` and log in.
2. Add a personal task (e.g. "Test promote feature", P1).
3. Click "↗ promote" next to the task — flyout appears with workstream list.
4. Hover a workstream — node group submenu appears.
5. Click a node group — flyout closes, confirmation toast appears, task row disappears.
6. Switch to Board or Kanban view — new node is visible under the correct workstream/group.

- [ ] **Step 9: Commit**

```bash
git add packages/client/src/pages/TasksView.tsx
git commit -m "feat: promote personal task to graph node via workstream flyout"
```

---

## Definition of Done

```bash
npm run build --workspace=packages/shared
npm run typecheck --workspace=packages/server
npm run typecheck --workspace=packages/client
npm run test --workspace=packages/server
```

All pass, no type errors.
