# Workstream Drag-Reorder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow users to drag collapsed workstream headers to reorder them in Board view, persisted to the database.

**Architecture:** Add a `sort_order` integer column to the `nodes` table. Workstream headers (which are already nodes) get a `sort_order` value. The Board view sorts workstreams by `sort_order` instead of alphabetically. Drag-drop on collapsed headers PATCHes the sort_order of affected headers via the existing API.

**Tech Stack:** SQLite (ALTER TABLE), Drizzle ORM, Express PATCH endpoint, React drag events, Zustand store.

---

### Task 1: Add `sort_order` column to schema and database

**Files:**
- Modify: `packages/shared/src/schema/index.ts:13-34` (nodes table)
- Modify: `packages/shared/src/types/index.ts:15-34` (Node interface)
- Modify: `packages/server/src/db.ts:16-69` (initTables, add migration)

- [ ] **Step 1: Add `sortOrder` to the Drizzle schema**

In `packages/shared/src/schema/index.ts`, add after line 27 (`positionPinned`):

```typescript
  sortOrder: integer("sort_order"),
```

- [ ] **Step 2: Add `sortOrder` to the Node TypeScript interface**

In `packages/shared/src/types/index.ts`, add after `positionPinned` (line 29):

```typescript
  sortOrder: number | null;
```

- [ ] **Step 3: Add migration in `initTables`**

In `packages/server/src/db.ts`, add after the `CREATE INDEX` statement (after line 68), inside the `initTables` function:

```typescript
  // Migrations — idempotent ALTER TABLE additions
  try {
    sqlite.exec(`ALTER TABLE nodes ADD COLUMN sort_order INTEGER`);
  } catch {
    // Column already exists — ignore
  }
```

This pattern is safe because SQLite throws "duplicate column name" if the column exists, and the try/catch swallows it.

- [ ] **Step 4: Build shared types**

Run: `npm run build --workspace=packages/shared`
Expected: Clean build, no errors.

- [ ] **Step 5: Typecheck server**

Run: `npm run typecheck --workspace=packages/server`
Expected: Clean, no errors.

- [ ] **Step 6: Run server tests**

Run: `npm run test --workspace=packages/server`
Expected: All 60 tests pass. The test helper calls `initTables` which will run the migration on the in-memory test DB.

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/schema/index.ts packages/shared/src/types/index.ts packages/server/src/db.ts
git commit -m "feat: add sort_order column to nodes table"
```

---

### Task 2: Wire `sort_order` through the API (PATCH endpoint)

**Files:**
- Modify: `packages/server/src/routes/nodes.ts:25-44` (Zod schemas)
- Modify: `packages/server/src/routes/nodes.ts:160-176` (PATCH handler changes block)

- [ ] **Step 1: Add `sort_order` to Zod schemas**

In `packages/server/src/routes/nodes.ts`, add to `createSchema` (after line 38, the `position_pinned` field):

```typescript
  sort_order: z.number().int().nullable().optional(),
```

The `updateSchema` inherits this via `.partial()` so no change needed there.

- [ ] **Step 2: Add `sort_order` to the PATCH changes block**

In `packages/server/src/routes/nodes.ts`, add after line 175 (`if (data.position_pinned !== undefined)...`):

```typescript
    if (data.sort_order !== undefined) changes.sortOrder = data.sort_order;
```

- [ ] **Step 3: Add `sort_order` to the POST handler**

In `packages/server/src/routes/nodes.ts`, add to the `db.insert(nodes).values({...})` block (after line 129, the `positionPinned` field):

```typescript
          sortOrder: data.sort_order ?? null,
```

- [ ] **Step 4: Run server tests**

Run: `npm run test --workspace=packages/server`
Expected: All 60 tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/routes/nodes.ts
git commit -m "feat: wire sort_order through node API endpoints"
```

---

### Task 3: Sort workstreams by `sort_order` in Board view

**Files:**
- Modify: `packages/client/src/pages/BoardView.tsx:64-78` (workstreams memo)

- [ ] **Step 1: Replace alphabetical sort with sort_order-aware sort**

In `packages/client/src/pages/BoardView.tsx`, replace the `workstreams` useMemo (lines 64-78):

```typescript
  // Build a map of workstream name -> sort_order from ws header nodes
  const wsHeaderMap = useMemo(() => {
    const map = new Map<string, { sortOrder: number | null; headerId: string }>();
    for (const n of nodes) {
      if (!parentMap.has(n.id) && !isGoalNode(n) && n.name && !n.workstream) {
        map.set(n.name, { sortOrder: n.sortOrder, headerId: n.id });
      }
    }
    return map;
  }, [nodes, parentMap]);

  const workstreams = useMemo(() => {
    const ws = new Set<string>();
    for (const n of nodes) {
      if (n.workstream) ws.add(n.workstream);
    }
    for (const n of nodes) {
      if (!parentMap.has(n.id) && !isGoalNode(n) && n.name) {
        ws.add(n.name);
      }
    }
    return Array.from(ws).sort((a, b) => {
      const aOrder = wsHeaderMap.get(a)?.sortOrder;
      const bOrder = wsHeaderMap.get(b)?.sortOrder;
      // Nodes with sort_order come first, sorted by sort_order
      // Nodes without sort_order fall back to alphabetical at the end
      if (aOrder != null && bOrder != null) return aOrder - bOrder;
      if (aOrder != null) return -1;
      if (bOrder != null) return 1;
      return a.localeCompare(b);
    });
  }, [nodes, parentMap, wsHeaderMap]);
```

- [ ] **Step 2: Typecheck client**

Run: `npx tsc --noEmit -p packages/client/tsconfig.json`
Expected: Clean, no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/client/src/pages/BoardView.tsx
git commit -m "feat: sort workstreams by sort_order instead of alphabetically"
```

---

### Task 4: Add drag-reorder handlers for collapsed workstream headers

**Files:**
- Modify: `packages/client/src/pages/BoardView.tsx` (add new ref, handlers, and modify header JSX)

- [ ] **Step 1: Add a ref to track workstream drag state**

In `packages/client/src/pages/BoardView.tsx`, after `boardDrag` ref (line 60):

```typescript
  const wsDrag = useRef<{ ws: string } | null>(null);
```

- [ ] **Step 2: Add workstream drag event handlers**

Add these functions after the existing `onBoardDragLeave` function (after line 266):

```typescript
  function onWsDragStart(e: React.DragEvent, ws: string) {
    wsDrag.current = { ws };
    e.dataTransfer.effectAllowed = "move";
    (e.target as HTMLElement).classList.add("dragging");
  }

  function onWsDragEnd(e: React.DragEvent) {
    (e.target as HTMLElement).classList.remove("dragging");
    document.querySelectorAll(".ws-drag-over-top,.ws-drag-over-bottom").forEach((el) => {
      el.classList.remove("ws-drag-over-top", "ws-drag-over-bottom");
    });
    wsDrag.current = null;
  }

  function onWsDragOver(e: React.DragEvent, targetWs: string) {
    e.preventDefault();
    if (!wsDrag.current || wsDrag.current.ws === targetWs) return;
    e.dataTransfer.dropEffect = "move";
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const mid = rect.top + rect.height / 2;
    (e.currentTarget as HTMLElement).classList.remove("ws-drag-over-top", "ws-drag-over-bottom");
    (e.currentTarget as HTMLElement).classList.add(e.clientY < mid ? "ws-drag-over-top" : "ws-drag-over-bottom");
  }

  function onWsDragLeave(e: React.DragEvent) {
    (e.currentTarget as HTMLElement).classList.remove("ws-drag-over-top", "ws-drag-over-bottom");
  }

  async function onWsDrop(e: React.DragEvent, targetWs: string) {
    e.preventDefault();
    (e.currentTarget as HTMLElement).classList.remove("ws-drag-over-top", "ws-drag-over-bottom");
    if (!wsDrag.current || wsDrag.current.ws === targetWs) return;

    const dragWs = wsDrag.current.ws;
    wsDrag.current = null;

    // Compute new order
    const currentOrder = [...workstreams];
    const fromIdx = currentOrder.indexOf(dragWs);
    const toIdx = currentOrder.indexOf(targetWs);
    if (fromIdx < 0 || toIdx < 0) return;

    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const insertAfter = e.clientY >= rect.top + rect.height / 2;

    const reordered = currentOrder.filter((w) => w !== dragWs);
    const insertIdx = reordered.indexOf(targetWs) + (insertAfter ? 1 : 0);
    reordered.splice(insertIdx, 0, dragWs);

    // Assign sort_order values with gaps of 10
    const patches: Array<{ id: string; sortOrder: number }> = [];
    for (let i = 0; i < reordered.length; i++) {
      const header = wsHeaderMap.get(reordered[i]);
      if (header) {
        patches.push({ id: header.headerId, sortOrder: (i + 1) * 10 });
      }
    }

    // Optimistic update: patch local store immediately
    for (const p of patches) {
      updateNode(p.id, { sortOrder: p.sortOrder });
    }

    // Persist to API
    try {
      await Promise.all(
        patches.map((p) =>
          api(`/nodes/${p.id}`, {
            method: "PATCH",
            body: JSON.stringify({ sort_order: p.sortOrder }),
          })
        )
      );
    } catch (err) {
      console.error("[BoardView] workstream reorder failed:", err);
      // Refetch to restore consistent state
      const graph = await api<{ nodes: Node[]; edges: Edge[] }>("/graph");
      setNodes(graph.nodes);
      setEdges(graph.edges);
    }
  }
```

- [ ] **Step 3: Wire drag handlers onto the workstream header div**

In `packages/client/src/pages/BoardView.tsx`, find the workstream header div (around line 802-803):

Replace the existing `<div key={ws} className="board-group">` and the `<div className="board-group-header"...>` with:

```tsx
          <div
            key={ws}
            className="board-group"
            onDragOver={isWsCollapsed ? (e) => onWsDragOver(e, ws) : undefined}
            onDragLeave={isWsCollapsed ? onWsDragLeave : undefined}
            onDrop={isWsCollapsed ? (e) => onWsDrop(e, ws) : undefined}
          >
            <div
              className="board-group-header"
              style={{ cursor: "pointer" }}
              draggable={isWsCollapsed}
              onDragStart={isWsCollapsed ? (e) => onWsDragStart(e, ws) : undefined}
              onDragEnd={isWsCollapsed ? onWsDragEnd : undefined}
              onClick={() => setCollapsedWorkstreams((prev) => { const n = new Set(prev); if (n.has(ws)) n.delete(ws); else n.add(ws); return n; })}
            >
```

The key change: `draggable={isWsCollapsed}` and the drag event handlers are only attached when the workstream is collapsed.

- [ ] **Step 4: Add a grab handle to collapsed workstream headers**

Inside the `.board-group-header` div, add a grab handle as the first child (before the collapse arrow), only when collapsed. Find the line with the collapse arrow (`\u25B6` / `\u25BC`) and add before it:

```tsx
              {isWsCollapsed && (
                <div style={{ fontSize: 10, color: "#CCC", cursor: "grab", width: 14, flexShrink: 0, userSelect: "none" }} className="ws-drag-handle">::</div>
              )}
```

- [ ] **Step 5: Typecheck client**

Run: `npx tsc --noEmit -p packages/client/tsconfig.json`
Expected: Clean, no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/client/src/pages/BoardView.tsx
git commit -m "feat: drag-reorder collapsed workstream headers in Board view"
```

---

### Task 5: Add CSS for workstream drag feedback

**Files:**
- Modify: `packages/client/src/index.css` (add workstream drag styles)

- [ ] **Step 1: Add workstream drag CSS**

In `packages/client/src/index.css`, find the existing board drag styles (`.board-card.dragging`, `.board-card.drag-over-top`, `.board-card.drag-over-bottom`) and add nearby:

```css
.board-group.ws-drag-over-top { border-top: 2px solid #B81917; }
.board-group.ws-drag-over-bottom { border-bottom: 2px solid #B81917; }
.board-group-header[draggable="true"] { cursor: grab; }
.board-group-header[draggable="true"]:active { cursor: grabbing; }
.ws-drag-handle:active { cursor: grabbing; }
```

- [ ] **Step 2: Commit**

```bash
git add packages/client/src/index.css
git commit -m "feat: CSS feedback for workstream drag-reorder"
```

---

### Task 6: Verify updateNode handles sortOrder in the Zustand store

**Files:**
- Modify: `packages/client/src/stores/graphStore.ts` (verify updateNode signature)

- [ ] **Step 1: Check that the Zustand store's `updateNode` accepts `sortOrder`**

Read `packages/client/src/stores/graphStore.ts` and find the `updateNode` action. It should accept `Partial<Node>` (which now includes `sortOrder` from the shared types). If it does, no change needed. If it uses a restricted type, add `sortOrder` to it.

The `updateNode` function typically does:
```typescript
updateNode: (id, changes) => set((s) => ({
  nodes: s.nodes.map((n) => n.id === id ? { ...n, ...changes } : n),
}))
```

If `changes` is typed as `Partial<Node>`, it already works because we added `sortOrder` to the `Node` interface in Task 1.

- [ ] **Step 2: Typecheck client**

Run: `npx tsc --noEmit -p packages/client/tsconfig.json`
Expected: Clean.

- [ ] **Step 3: Run full verification**

Run:
```bash
npm run build --workspace=packages/shared
npm run typecheck --workspace=packages/server
npm run typecheck --workspace=packages/client
npm run test --workspace=packages/server
```
Expected: All clean, all tests pass.

- [ ] **Step 4: Final commit (if any store changes were needed)**

```bash
git add packages/client/src/stores/graphStore.ts
git commit -m "fix: ensure Zustand store handles sortOrder in updateNode"
```
