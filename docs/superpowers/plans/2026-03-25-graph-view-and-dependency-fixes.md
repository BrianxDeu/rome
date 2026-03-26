# Graph View + Dependency System Fixes

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix 4 issues: web-style graph layout, visible dependency edge lines, working blocker/dependency add from detail panel, and duplicate workstream node prevention.

**Architecture:** The graph view (GraphView.tsx) uses a custom SVG renderer with a `computeLayout()` function for positioning. Edges are filtered and drawn as SVG lines. The detail panel (NodePanel.tsx) handles dependency add/remove. The Zustand store (graphStore.ts) manages state. All node/edge mutations go through REST API at `/api/nodes` and `/api/edges`.

**Tech Stack:** React 19, SVG, Zustand, Express, Drizzle ORM, SQLite

---

### Task 1: Fix Duplicate Workstream Nodes (Store Deduplication)

**Files:**
- Modify: `packages/client/src/stores/graphStore.ts`
- Modify: `packages/client/src/hooks/useSync.ts`

The `addNode` and `addEdge` store methods blindly append. When a user creates a workstream, the modal calls `addNode(node)` AND Socket.IO broadcasts `node:created` which also calls `addNode(node)` — creating a duplicate in the store array.

- [ ] **Step 1: Fix addNode to deduplicate by ID**

In `packages/client/src/stores/graphStore.ts`, change the `addNode` method:

```typescript
// BEFORE:
addNode: (node) => set((state) => ({ nodes: [...state.nodes, node] })),

// AFTER:
addNode: (node) => set((state) => ({
  nodes: state.nodes.some((n) => n.id === node.id)
    ? state.nodes.map((n) => (n.id === node.id ? node : n))
    : [...state.nodes, node],
})),
```

If the node ID already exists, update it in place. Otherwise append. This makes addNode idempotent.

- [ ] **Step 2: Fix addEdge to deduplicate by ID**

Same file, change the `addEdge` method:

```typescript
// BEFORE:
addEdge: (edge) => set((state) => ({ edges: [...state.edges, edge] })),

// AFTER:
addEdge: (edge) => set((state) => ({
  edges: state.edges.some((e) => e.id === edge.id)
    ? state.edges.map((e) => (e.id === edge.id ? edge : e))
    : [...state.edges, edge],
})),
```

- [ ] **Step 3: Verify and commit**

Run: `npx tsc --noEmit -p packages/client/tsconfig.json`
Expected: No errors

```bash
git add packages/client/src/stores/graphStore.ts
git commit -m "fix: deduplicate addNode/addEdge in Zustand store

Prevents duplicate entries when both the API response and Socket.IO
broadcast trigger addNode/addEdge for the same entity."
```

---

### Task 2: Fix Blocker/Dependency Add from Detail Panel (400 Error)

**Files:**
- Modify: `packages/client/src/components/NodePanel.tsx`
- Modify: `packages/server/src/routes/edges.ts`

Two issues: (1) the "add blocker" from the Board detail panel sends a malformed request causing 400, and (2) edge type change attempts PATCH `/edges/:id` which doesn't exist (404).

**Root cause analysis:** The NodePanel `handleAddEdge` function sends `{ source_id, target_id, type: "blocker" }` — this should work with the server's Zod schema. The 400 likely comes from the user selecting an invalid node (e.g., trying to create a self-referencing edge or a duplicate edge). The edge type change sends PATCH which returns 404 because no PATCH endpoint exists.

- [ ] **Step 1: Add PATCH endpoint for edges on server**

In `packages/server/src/routes/edges.ts`, add a PATCH handler before the DELETE handler. Find the line `router.delete("/:id"` and add before it:

```typescript
const updateSchema = z.object({
  type: z.enum(["blocks", "blocker", "depends_on", "sequence", "produces", "feeds", "shared", "parent_of"]).optional(),
});

router.patch("/:id", (req, res) => {
  const edge = db.select().from(edges).where(eq(edges.id, req.params.id!)).get();
  if (!edge) {
    res.status(404).json({ error: "Edge not found", code: "NOT_FOUND" });
    return;
  }

  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input", code: "VALIDATION_ERROR" });
    return;
  }

  const data = parsed.data;
  if (data.type) {
    db.update(edges).set({ type: data.type, updatedAt: new Date().toISOString() }).where(eq(edges.id, req.params.id!)).run();
  }

  const updated = db.select().from(edges).where(eq(edges.id, req.params.id!)).get();
  broadcast({ type: "edge:updated", payload: toEdgeJson(updated!) as unknown as Record<string, unknown> });
  res.json(toEdgeJson(updated!));
});
```

- [ ] **Step 2: Improve error handling in NodePanel handleAddEdge**

In `packages/client/src/components/NodePanel.tsx`, replace the silent `catch {}` in `handleAddEdge` (around line 130):

```typescript
// BEFORE:
    } catch {}

// AFTER:
    } catch (err) {
      console.error("[NodePanel] add edge failed:", err);
    }
```

Do the same for `handleEdgeTypeChange` (around line 151) and `handleRemoveEdge`.

- [ ] **Step 3: Verify and commit**

Run:
```bash
npm run build --workspace=packages/shared
npx tsc --noEmit -p packages/server/tsconfig.json
npx tsc --noEmit -p packages/client/tsconfig.json
```
Expected: No errors

```bash
git add packages/server/src/routes/edges.ts packages/client/src/components/NodePanel.tsx
git commit -m "fix: add PATCH endpoint for edges + improve error logging

Edge type changes from NodePanel were hitting a non-existent PATCH
endpoint (404). Added PATCH /edges/:id with type validation.
Also replaced silent catch blocks with console.error logging."
```

---

### Task 3: Redesign Graph Layout — Obsidian-Style Web

**Files:**
- Modify: `packages/client/src/pages/GraphView.tsx` (the `computeLayout` function, lines 28-102)

The current layout arranges clusters in a single vertical column radiating from a goal node. This creates the linear, stacked appearance seen in the screenshots. We need a force-directed-style layout that spreads nodes into a web pattern.

The new layout strategy:
- **Workstream clusters** arranged in a **horizontal spread** (not vertical stack)
- **Within each workstream**, cluster parents arranged in a **2-column grid** with horizontal spacing
- **Child nodes** fanned out **horizontally** around their parent
- **Overall shape**: wide web, not tall column
- No goal node dependency (there may not be one)

- [ ] **Step 1: Replace computeLayout with web-style layout**

Replace the entire `computeLayout` function in `packages/client/src/pages/GraphView.tsx` (lines 28-102) with:

```typescript
function computeLayout(
  nodes: Node[],
  edges: Edge[],
  childrenMap: Map<string, string[]>,
  parentMap: Map<string, string>,
): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>();

  const goalNode = nodes.find(isGoalNode);
  if (goalNode) {
    positions.set(goalNode.id, { x: 0, y: 0 });
  }

  // Group non-goal nodes by workstream
  const workstreams = new Map<string, Node[]>();
  for (const n of nodes) {
    if (goalNode && n.id === goalNode.id) continue;
    const ws = n.workstream ?? "Other";
    const group = workstreams.get(ws) ?? [];
    group.push(n);
    workstreams.set(ws, group);
  }

  const wsEntries = [...workstreams.entries()];
  const wsCount = wsEntries.length;

  // Spread workstreams radially around center with generous spacing
  const baseRadius = Math.max(250, wsCount * 80);

  wsEntries.forEach(([ws, wsNodes], wsIndex) => {
    const angle = (wsIndex / wsCount) * Math.PI * 2 - Math.PI / 2;
    const wsCenter = {
      x: Math.cos(angle) * baseRadius,
      y: Math.sin(angle) * baseRadius,
    };

    // Separate cluster parents from leaf nodes
    const clusterParents = wsNodes.filter((n) => childrenMap.has(n.id) && (childrenMap.get(n.id)?.length ?? 0) > 0);
    const leafNodes = wsNodes.filter((n) => !childrenMap.has(n.id) || (childrenMap.get(n.id)?.length ?? 0) === 0)
      .filter((n) => !parentMap.has(n.id)); // exclude children (positioned by parent)

    // Arrange cluster parents in a grid around workstream center
    const clusterSpacingX = 200;
    const clusterSpacingY = 160;
    const cols = Math.max(2, Math.ceil(Math.sqrt(clusterParents.length)));

    clusterParents.forEach((cluster, ci) => {
      const row = Math.floor(ci / cols);
      const col = ci % cols;
      const cx = wsCenter.x + (col - (cols - 1) / 2) * clusterSpacingX;
      const cy = wsCenter.y + (row - Math.floor(clusterParents.length / cols) / 2) * clusterSpacingY;
      positions.set(cluster.id, { x: cx, y: cy });

      // Fan children around parent in a horizontal arc
      const children = childrenMap.get(cluster.id) ?? [];
      const childRadius = Math.max(60, children.length * 18);
      const arcSpan = Math.min(Math.PI * 1.2, children.length * 0.5);
      const arcStart = angle - arcSpan / 2;

      children.forEach((childId, chi) => {
        const childAngle = children.length === 1
          ? angle
          : arcStart + (chi / (children.length - 1)) * arcSpan;
        positions.set(childId, {
          x: cx + Math.cos(childAngle) * childRadius,
          y: cy + Math.sin(childAngle) * childRadius,
        });
      });
    });

    // Place ungrouped leaf nodes in a ring around workstream center
    const leafRadius = clusterParents.length > 0 ? baseRadius * 0.3 : 60;
    leafNodes.forEach((leaf, li) => {
      const leafAngle = (li / Math.max(leafNodes.length, 1)) * Math.PI * 2;
      positions.set(leaf.id, {
        x: wsCenter.x + Math.cos(leafAngle) * leafRadius,
        y: wsCenter.y + Math.sin(leafAngle) * leafRadius,
      });
    });
  });

  return positions;
}
```

Key changes from current layout:
- `baseRadius` scales with workstream count (minimum 250px) — spreads wider
- Cluster parents use a **2-column grid** with 200px horizontal / 160px vertical spacing
- Children fan in a **wider arc** (1.2 radians vs 0.8) with larger radius
- Leaf nodes arranged in a **ring** around workstream center, not a vertical column
- Overall: horizontal web shape, not vertical stack

- [ ] **Step 2: Increase initial zoom-out to show full web**

In `GraphView.tsx`, find the viewport initialization (around line 167):

```typescript
// BEFORE:
const z = 1.4;

// AFTER:
const z = 0.9;
```

The web layout is wider so we need to zoom out more to show it all initially.

- [ ] **Step 3: Verify and commit**

Run: `npx tsc --noEmit -p packages/client/tsconfig.json`
Expected: No errors

```bash
git add packages/client/src/pages/GraphView.tsx
git commit -m "feat: redesign graph layout as Obsidian-style web

Replace vertical column layout with radial web layout. Workstream
clusters spread around center with generous spacing. Cluster parents
arranged in 2-column grids. Child nodes fan in wide arcs. Zoom
reduced to 0.9x to show full web on load."
```

---

### Task 4: Make Dependency Edge Lines More Visible

**Files:**
- Modify: `packages/client/src/pages/GraphView.tsx` (edge rendering section, around lines 395-418)

The edges currently render with very low opacity (0.35) and thin lines (0.8px). They're nearly invisible. Make them thicker, more colorful, and add proper arrowheads.

- [ ] **Step 1: Enhance edge line rendering**

In `GraphView.tsx`, find the edge rendering section (the `graphEdges.map` block, around line 395). Replace the SVG rendering of each edge:

```tsx
{graphEdges.map((edge, i) => {
  const sp = posMap.get(edge.sourceId);
  const tp = posMap.get(edge.targetId);
  if (!sp || !tp) return null;
  const dx = tp.x - sp.x;
  const dy = tp.y - sp.y;
  const dist = Math.sqrt(dx * dx + dy * dy) || 1;
  const nx = dx / dist;
  const ny = dy / dist;
  const r = 8;
  const x1 = sp.x + nx * r;
  const y1 = sp.y + ny * r;
  const x2 = tp.x - nx * r;
  const y2 = tp.y - ny * r;
  const isConnected = selId && (edge.sourceId === selId || edge.targetId === selId);
  const dim = selId && !isConnected;
  const edgeColor = edge.type === "blocks" || edge.type === "blocker" ? "#B81917"
    : edge.type === "depends_on" ? "#f59e0b"
    : edge.type === "sequence" ? "#3B82F6"
    : "#999";
  return (
    <g key={i} style={{ opacity: dim ? 0.08 : 0.6, transition: "opacity 0.2s" }}>
      <line
        x1={x1} y1={y1} x2={x2} y2={y2}
        stroke={edgeColor}
        strokeWidth={dim ? 0.8 : 1.5}
        strokeDasharray={edge.type === "depends_on" ? "4,3" : undefined}
      />
      {/* Arrowhead */}
      <polygon
        points={`${x2},${y2} ${x2 - nx * 6 + ny * 3},${y2 - ny * 6 - nx * 3} ${x2 - nx * 6 - ny * 3},${y2 - ny * 6 + nx * 3}`}
        fill={edgeColor}
      />
    </g>
  );
})}
```

Changes:
- **Color by type**: red for blocks/blocker, amber for depends_on, blue for sequence, gray for other
- **Thicker lines**: 1.5px normal (was 0.8px)
- **Higher opacity**: 0.6 normal (was 0.35)
- **Proper arrowheads**: SVG polygon instead of tiny circle
- **Dashed lines** for depends_on edges (distinguishes from blocks)

- [ ] **Step 2: Verify and commit**

Run: `npx tsc --noEmit -p packages/client/tsconfig.json`
Expected: No errors

```bash
git add packages/client/src/pages/GraphView.tsx
git commit -m "style: make dependency edges visible with color-coding and arrowheads

Edges now color-coded by type (red=blocks, amber=depends_on, blue=sequence).
Line width increased from 0.8 to 1.5px, opacity from 0.35 to 0.6.
Proper arrowhead polygons replace tiny endpoint circles.
depends_on edges use dashed lines for visual distinction."
```

---

## Summary

| Task | Issue | Key Change |
|------|-------|------------|
| 1 | Duplicate workstream nodes | Deduplicate addNode/addEdge in Zustand store |
| 2 | Blocker add returns 400/404 | Add PATCH endpoint for edges, improve error logging |
| 3 | Graph layout is vertical | Replace computeLayout with radial web layout |
| 4 | Dependency lines invisible | Color-code edges, thicker lines, arrowheads |
