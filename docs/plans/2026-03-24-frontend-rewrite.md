# Rome Frontend Rewrite — DxD Halo Ops Design

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Rome's current frontend with the DxD Halo Ops design — custom SVG graph with clusters, Board view, enhanced Gantt/Budget, and proper NodePanel with Save + RACI fields.

**Architecture:** The Rome app stays as React 19 + Vite + TypeScript + Zustand + Socket.io. We replace React Flow with a custom SVG graph renderer matching `dxd-halo-ops.html`. We add a Board view (Monday.com-style cards). We overhaul Gantt, Budget, and NodePanel. Backend gets minor edge-type expansion. No new dependencies added.

**Tech Stack:** React 19, TypeScript, Zustand, Vite, Express, Drizzle ORM, SQLite, Socket.io

**Source reference files (read-only, do NOT modify):**
- `/Users/briansullivan/Library/CloudStorage/OneDrive-DeusXDefense/Special Projects/CCowork/dxd-halo-ops.html` — Primary reference (4-view app, 1259 lines)
- `/Users/briansullivan/Library/CloudStorage/OneDrive-DeusXDefense/Special Projects/CCowork/dxd-graph-pm.html` — Supplementary (graph-only, 1205 lines)
- `/Users/briansullivan/Library/CloudStorage/OneDrive-DeusXDefense/Special Projects/CCowork/DXD-HALO-OPS-HANDOFF.md` — Context doc

**Brand constants used throughout:**
```
ROME_RED = #B81917
PRIORITIES: P0=#1A1A1A, P1=#B81917, P2=#3B82F6, P3=#8B5CF6
STATUSES: not_started=#999, in_progress=#2563eb, blocked=#dc2626, done=#16a34a, cancelled=#9ca3af
Font: Tomorrow
Background: white (#FFFFFF)
```

**IMPORTANT — Status naming:** The reference HTML uses `complete` but Rome uses `done`. Always use `done`, never `complete`.

**IMPORTANT — API field naming:** The backend expects snake_case for date fields (`start_date`, `end_date`, `position_pinned`). The frontend store uses camelCase (`startDate`, `endDate`). When PATCHing to the API, always send snake_case keys. This is a known bug in the existing NodePanel — fix it in Task 6.

---

## File Structure

### New files to create:
| File | Responsibility |
|------|---------------|
| `packages/client/src/constants.ts` | Shared brand colors, priorities, statuses, edge types |
| `packages/client/src/pages/BoardView.tsx` | Monday.com-style card view grouped by workstream/cluster |
| `packages/client/src/components/AddNodeModal.tsx` | Progressive disclosure node creation modal |

### Files to modify:
| File | Changes |
|------|---------|
| `packages/server/src/routes/edges.ts` | Expand edge type enum: add `blocker`, `sequence`, `produces`, `feeds`, `shared`, `depends_on` |
| `packages/client/src/components/TopBar.tsx` | Add "Board" tab to ViewTab type and tabs array |
| `packages/client/src/Shell.tsx` | Add BoardView routing + import |
| `packages/client/src/stores/graphStore.ts` | Add `collapsed` Set for cluster state, `groups` derived data |
| `packages/client/src/pages/GraphView.tsx` | Complete rewrite: custom SVG with clusters, rings, selection dimming, edge types |
| `packages/client/src/pages/GanttView.tsx` | Overhaul: 4 time scales, auto-scroll to today, exclude clusters, better bars |
| `packages/client/src/pages/BudgetView.tsx` | Overhaul: hero total, workstream bar chart, priority table, filterable/sortable items, inline budget edit |
| `packages/client/src/components/NodePanel.tsx` | Add Save button, RACI as 4 fields, dependency management section, edge type labels |
| `packages/server/src/seed.ts` | Add dates, fix budgets for all nodes so Gantt/Budget are populated |

### Files also modified (bug fixes):
| File | Changes |
|------|---------|
| `packages/client/src/api.ts` | Handle 204 responses (DELETE returns no body, `res.json()` crashes) |

### Files NOT changed:
| File | Reason |
|------|--------|
| `packages/shared/src/schema/index.ts` | No schema changes — existing fields suffice |
| `packages/shared/src/types/index.ts` | No type changes needed |
| `packages/client/src/hooks/useGraph.ts` | No changes needed |
| `packages/client/src/hooks/useSync.ts` | No changes needed |

---

## Task 1: Foundation — Constants, Store, TopBar, Shell

**Files:**
- Create: `packages/client/src/constants.ts`
- Modify: `packages/client/src/stores/graphStore.ts`
- Modify: `packages/client/src/components/TopBar.tsx`
- Modify: `packages/client/src/Shell.tsx`
- Modify: `packages/server/src/routes/edges.ts`

- [ ] **Step 1: Create constants.ts**

```typescript
// packages/client/src/constants.ts
export const PRIORITIES: Record<string, { label: string; color: string }> = {
  P0: { label: "Critical", color: "#1A1A1A" },
  P1: { label: "Urgent", color: "#B81917" },
  P2: { label: "High", color: "#3B82F6" },
  P3: { label: "Medium", color: "#8B5CF6" },
};

export const STATUSES: Record<string, { label: string; color: string }> = {
  not_started: { label: "Not Started", color: "#999999" },
  in_progress: { label: "In Progress", color: "#2563eb" },
  blocked: { label: "Blocked", color: "#dc2626" },
  done: { label: "Done", color: "#16a34a" },
  cancelled: { label: "Cancelled", color: "#9ca3af" },
};

export const EDGE_TYPES: Record<string, { label: string; color: string; dash?: string }> = {
  blocks: { label: "Blocks", color: "#dc2626" },
  blocker: { label: "Blocker", color: "#dc2626" },
  depends_on: { label: "Depends On", color: "#dc2626" },
  sequence: { label: "Sequence", color: "#f59e0b" },
  produces: { label: "Produces", color: "#16a34a" },
  feeds: { label: "Feeds", color: "#3B82F6" },
  shared: { label: "Shared", color: "#8B5CF6", dash: "4 2" },
  parent_of: { label: "Parent Of", color: "#999" },
};

export function statusLabel(s: string): string {
  return STATUSES[s]?.label ?? s.replace(/_/g, " ");
}

export function statusColor(s: string): string {
  return STATUSES[s]?.color ?? "#999";
}

export function priorityColor(p: string): string {
  return PRIORITIES[p]?.color ?? "#999";
}

// --- Cluster derivation utilities (shared across all views) ---
import type { Node, Edge } from "@rome/shared";

export function buildClusterMaps(edges: Edge[]) {
  const parentMap = new Map<string, string>();   // childId -> parentId
  const childrenMap = new Map<string, string[]>(); // parentId -> childIds
  for (const e of edges) {
    if (e.type === "parent_of") {
      parentMap.set(e.targetId, e.sourceId);
      const children = childrenMap.get(e.sourceId) ?? [];
      children.push(e.targetId);
      childrenMap.set(e.sourceId, children);
    }
  }
  return { parentMap, childrenMap };
}

export function isClusterNode(nodeId: string, childrenMap: Map<string, string[]>): boolean {
  return (childrenMap.get(nodeId)?.length ?? 0) > 0;
}

export function parseRaci(raci: string | null): { responsible: string; accountable: string; consulted: string; informed: string } {
  const empty = { responsible: "", accountable: "", consulted: "", informed: "" };
  if (!raci) return empty;
  try {
    let str = raci;
    // Handle double-escaped JSON bug
    if (str.startsWith('"') && str.endsWith('"')) str = JSON.parse(str);
    const parsed = typeof str === "string" ? JSON.parse(str) : str;
    return { ...empty, ...parsed };
  } catch {
    return empty;
  }
}
```

- [ ] **Step 2: Update graphStore — add collapsed set and helper selectors**

Add to `graphStore.ts`:
- `collapsed: Set<string>` — tracks collapsed cluster node IDs
- `toggleCollapsed(id: string)` — toggle a cluster's collapsed state
- Remove `responsible` from Filters (unused in new design), keep `status` and `workstream`

```typescript
// Add to GraphState interface:
collapsed: Set<string>;
toggleCollapsed: (id: string) => void;

// Add to create():
collapsed: new Set<string>(),
toggleCollapsed: (id) =>
  set((state) => {
    const next = new Set(state.collapsed);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return { collapsed: next };
  }),
```

- [ ] **Step 3: Update TopBar — add Board tab**

In `TopBar.tsx`, change the ViewTab type and tabs array:

```typescript
export type ViewTab = "graph" | "board" | "gantt" | "budget";

const tabs: { id: ViewTab; label: string }[] = [
  { id: "graph", label: "Graph" },
  { id: "board", label: "Board" },
  { id: "gantt", label: "Gantt" },
  { id: "budget", label: "Budget" },
];
```

- [ ] **Step 4: Update Shell — add BoardView routing**

In `Shell.tsx`, add the Board view case:

```typescript
import { BoardView } from "./pages/BoardView";

// In the view switch:
{activeView === "board" ? (
  <BoardView onNavigateToNode={handleNavigateToNode} />
) : activeView === "budget" ? (
  ...
```

Also: show NodePanel only when NOT on board view (board uses inline editing):
```typescript
{selectedNode && activeView !== "board" && <NodePanel />}
```

- [ ] **Step 5: Expand edge types on backend + fix cycle detection**

In `packages/server/src/routes/edges.ts`:

a) Expand the Zod enum:
```typescript
const createSchema = z.object({
  source_id: z.string(),
  target_id: z.string(),
  type: z.enum(["blocks", "blocker", "depends_on", "sequence", "produces", "feeds", "shared", "parent_of"]),
});
```

b) Update `wouldCreateCycle` to follow ALL dependency-type edges (not just `blocks`):
```typescript
const DEPENDENCY_TYPES = new Set(["blocks", "blocker", "depends_on", "sequence"]);

function wouldCreateCycle(db: Db, sourceId: string, targetId: string): boolean {
  // ... existing BFS logic but change the edge query to:
  const outgoing = db.select().from(edges)
    .where(eq(edges.sourceId, current))
    .all()
    .filter(e => DEPENDENCY_TYPES.has(e.type));
  // ...
}
```

c) Update the cycle check guard to apply to all dependency types:
```typescript
if (DEPENDENCY_TYPES.has(type)) {
  if (wouldCreateCycle(db, source_id, target_id)) { ... }
}
```

- [ ] **Step 5b: Fix api.ts to handle 204 responses**

In `packages/client/src/api.ts`, add a guard before `res.json()`:
```typescript
if (res.status === 204) return undefined as T;
```

- [ ] **Step 6: Commit foundation changes**

```bash
git add packages/client/src/constants.ts packages/client/src/stores/graphStore.ts \
  packages/client/src/components/TopBar.tsx packages/client/src/Shell.tsx \
  packages/server/src/routes/edges.ts
git commit -m "feat: foundation for frontend rewrite — constants, Board tab, expanded edge types"
```

---

## Task 2: Graph View Rewrite (Custom SVG)

**Files:**
- Rewrite: `packages/client/src/pages/GraphView.tsx`

This is the largest task. Replace React Flow with a custom SVG renderer matching `dxd-halo-ops.html`.

**Reference:** Read `dxd-halo-ops.html` lines 800-1100 (graph rendering) and `dxd-graph-pm.html` lines 300-500 (node/edge components).

- [ ] **Step 1: Remove @xyflow/react dependency and clear GraphView.tsx**

Delete all React Flow imports and the existing implementation. Keep the file but gut the contents.

- [ ] **Step 2: Implement viewport state and SVG container**

The graph needs pan (mouse drag on background) and zoom (scroll wheel, range 0.15x-4x). Use a viewport state `{x, y, zoom}` applied as a CSS transform on a root `<g>`.

```typescript
const [vp, setVp] = useState({ x: 0, y: 0, zoom: 1 });
const svgRef = useRef<SVGSVGElement>(null);

// Pan: mousedown on SVG background sets panning=true, mousemove updates vp.x/vp.y
// Zoom: wheel event adjusts vp.zoom toward cursor position, clamped [0.15, 4]
```

SVG fills the container with `width="100%" height="100%"`. Inner `<g>` gets `transform={translate(${vp.x},${vp.y}) scale(${vp.zoom})}`.

- [ ] **Step 3: Implement concentric rings**

Draw 3 dashed circles at radii 200, 400, 600 centered at (0,0). Light gray stroke, opacity 0.15.

- [ ] **Step 4: Derive cluster and parent relationships from edges**

From the store's edges, build:
- `parentMap: Map<string, string>` — childId -> parentId (from `parent_of` edges)
- `childrenMap: Map<string, string[]>` — parentId -> childIds
- `clusterNodes` — nodes that have children (are parents in parent_of edges)
- `leafNodes` — nodes that are not cluster parents

- [ ] **Step 5: Implement cluster rendering (expanded/collapsed)**

Cluster parents render as rounded rectangles:
- **Expanded**: Bounding box around all child nodes + 50px padding. Colored header bar with cluster name + collapse toggle (down arrow). Background fill at 3% opacity of workstream color.
- **Collapsed**: Small 150x22 rectangle with colored border, cluster name, child count badge, expand toggle (right arrow).

Use the `collapsed` Set from graphStore. Clicking the toggle calls `toggleCollapsed(id)`.

- [ ] **Step 6: Implement node rendering**

Each visible node renders as an SVG circle:
- Radius: 7 (leaf nodes), 14 (goal node if present)
- Fill: priority color from constants
- Selected: +2 radius, black 2.5px stroke
- Complete status: green dashed ring overlay, 50% opacity
- Hidden if parent cluster is collapsed

Label renders below node as `<text>`, truncated to ~20 chars, font-size 10.

- [ ] **Step 7: Implement edge rendering**

Edges render as SVG lines with arrowhead markers:
- Color from EDGE_TYPES constant based on edge.type
- Dashed for `shared` type
- Arrow marker at target end (6px polygon)
- When a cluster is collapsed, edges from hidden children reroute to the cluster parent node (deduplicated)
- Selection dimming: edges not connected to selected node dim to 12% opacity

- [ ] **Step 8: Implement node dragging**

In select mode:
- mouseDown on node: set `dragNode` state, record offset
- mouseMove: update node's x,y to SVG-space mouse position (convert via viewport transform)
- mouseUp: clear drag state, PATCH node position to API
- Cluster rigid-body drag: when dragging a cluster parent, move all children by same delta

- [ ] **Step 9: Implement selection dimming**

When a node is selected:
- The selected node renders at full opacity
- Nodes connected to selected (via any edge) render at full opacity
- Sibling nodes (same parent) render at full opacity
- All other nodes dim to 25% opacity
- Unrelated edges dim to 12% opacity
- Click on SVG background deselects

- [ ] **Step 10: Implement workstream group overlays**

For each workstream, compute bounding box of its visible nodes + 50px padding. Render as dashed rectangle with workstream color at 35% opacity, with workstream label.

- [ ] **Step 11: Implement filter bar**

Two dropdowns at top of graph area:
- Status filter: "All statuses" + each status from constants
- Workstream filter: "All workstreams" + unique workstreams from nodes

When a filter is active, non-matching nodes dim (not hidden) — same dimming behavior as selection.

- [ ] **Step 12: Implement zoom controls**

Bottom-left control panel with 3 buttons:
- Zoom In (+)
- Zoom Out (-)
- Fit View (reset viewport to show all nodes)

- [ ] **Step 13: Remove @xyflow/react from package.json**

```bash
cd packages/client && npm uninstall @xyflow/react
```

- [ ] **Step 14: Commit graph view rewrite**

```bash
git add packages/client/src/pages/GraphView.tsx packages/client/package.json packages/client/package-lock.json
git commit -m "feat: custom SVG graph view with clusters, dimming, edge types, drag"
```

---

## Task 3: Board View (New)

**Files:**
- Create: `packages/client/src/pages/BoardView.tsx`

**Reference:** Read `dxd-halo-ops.html` lines ~850-1000 (board view section).

- [ ] **Step 1: Create BoardView.tsx with workstream groups**

The Board view is a vertical scrollable list of workstream sections. Each workstream section has:
- Header: colored dot + workstream label + node count
- Cards grouped by cluster sub-groups (derived from parent_of edges)
- "Other" section for ungrouped nodes
- Each section is collapsible

```typescript
interface BoardViewProps {
  onNavigateToNode: (nodeId: string) => void;
}
```

- [ ] **Step 2: Implement card component**

Each node renders as a card with:
- Left accent bar colored by priority
- Title, priority chip (colored), status chip (colored)
- Owner/responsible name (from RACI JSON if available)
- Click to expand → shows editable fields: notes textarea, deliverables textarea, status/priority selects, budget input, date inputs
- "VIEW IN GRAPH" button calls `onNavigateToNode`
- "DELETE" button calls API

- [ ] **Step 3: Implement inline editing and API persistence**

When a card is expanded:
- Changes update Zustand store immediately for UI responsiveness
- On blur or select change, PATCH to API
- Status/priority changes via dropdown
- Notes/deliverables via textarea
- Budget via number input
- Dates via date inputs

- [ ] **Step 4: Implement collapsible cluster sub-groups**

Within each workstream section, nodes that share a cluster parent are grouped under a sub-header:
- Left colored border (workstream color)
- Toggle arrow (expand/collapse)
- Cluster name + child count
- Collapsed by default

- [ ] **Step 5: Implement add node inline**

At the bottom of each workstream section, a dashed-border "+" row. Click reveals inline input + ADD/CANCEL buttons. On ADD:
- POST to /api/nodes with name, workstream, default priority/status
- If inside a cluster sub-group, also POST parent_of edge
- Add to store

- [ ] **Step 6: Commit Board view**

```bash
git add packages/client/src/pages/BoardView.tsx
git commit -m "feat: Board view — Monday.com-style cards with cluster sub-groups"
```

---

## Task 4: Gantt View Overhaul

**Files:**
- Rewrite: `packages/client/src/pages/GanttView.tsx`

**Reference:** Read `dxd-halo-ops.html` lines ~1000-1100 (gantt section).

- [ ] **Step 1: Clear and rewrite GanttView.tsx**

New Gantt has:
- 4 time scale buttons: WEEK (40px/day), MONTH (12px/day), QUARTER (4px/day), YEAR (1.5px/day). The `TimeScale` type must include `"year"` — existing code only has week/month/quarter
- Time range: auto-computed from node dates, default March 2026 - January 2027
- Left sidebar (220px) with workstream group headers + task rows
- Scrollable canvas with time grid + bars

- [ ] **Step 2: Implement sidebar with workstream grouping**

Left panel shows:
- Workstream headers (colored text, non-clickable)
- Task rows (clickable → selects node, navigates to graph)
- Exclude cluster parent nodes and goal nodes
- Fixed 32px row height

- [ ] **Step 3: Implement canvas with time grid and bars**

Right panel (scrollable both horizontally and vertically):
- Sticky header row with time period labels
- For each task: colored bar positioned by startDate/endDate, filled with priority color
- Complete tasks at 50% opacity
- Bar label if width > 60px
- Empty rows for workstream headers

- [ ] **Step 4: Implement today line and auto-scroll**

Red dashed vertical line at today's date position. On mount and scale change, scroll horizontally to bring today line near left edge (offset by ~100px).

- [ ] **Step 5: Implement unscheduled section**

Tasks without start/end dates listed below the chart in a simple list with status dot + name + workstream. Clickable to select.

- [ ] **Step 6: Implement dependency arrows**

For `blocks`/`depends_on`/`blocker` edges between visible tasks, draw bezier curves from source bar's right edge to target bar's left edge. Use SVG overlay positioned over the canvas.

- [ ] **Step 7: Commit Gantt overhaul**

```bash
git add packages/client/src/pages/GanttView.tsx
git commit -m "feat: Gantt overhaul — 4 time scales, auto-scroll, dependency arrows"
```

---

## Task 5: Budget View Overhaul

**Files:**
- Rewrite: `packages/client/src/pages/BudgetView.tsx`

**Reference:** Read `dxd-halo-ops.html` lines ~1100-1200 (budget section).

- [ ] **Step 1: Clear and rewrite BudgetView.tsx**

New layout (top to bottom):
1. Hero: large red total budget number + "Total Allocated" subtitle
2. By Workstream: horizontal bar chart
3. By Priority: simple table (Priority, Count, Budget)
4. Budget Items: filterable, sortable table with inline budget editing

- [ ] **Step 2: Implement hero section**

Large `$X,XXX,XXX` in rome-red, centered, with "Total Allocated" subtitle. Sum of all node budgets.

- [ ] **Step 3: Implement workstream bar chart**

For each workstream, a horizontal bar showing proportion of total budget. Bar colored by workstream. Percentage inside bar, dollar amount on right. Use the existing `/api/budget` endpoint for rollup data.

- [ ] **Step 4: Implement priority breakdown table**

Simple 3-column table: Priority (with color chip), Count, Budget. One row per P0-P3.

- [ ] **Step 5: Implement filterable/sortable items table**

- Workstream filter dropdown (All + each workstream)
- Sortable columns: Task, Priority, Workstream, Status, Owner, Budget
- Click column header to sort (toggle asc/desc)
- Budget column: inline `<input type="number">` that PATCHes on blur
- Click task name → navigateToNode
- Exclude cluster parent nodes
- Footer row with filtered total

- [ ] **Step 6: Use human-readable status labels**

Import `statusLabel` from constants.ts. Display "Not Started" instead of "not_started" everywhere.

- [ ] **Step 7: Commit Budget overhaul**

```bash
git add packages/client/src/pages/BudgetView.tsx
git commit -m "feat: Budget overhaul — hero total, bar chart, priority table, inline editing"
```

---

## Task 6: NodePanel Overhaul

**Files:**
- Rewrite: `packages/client/src/components/NodePanel.tsx`

**Reference:** Read `dxd-halo-ops.html` lines ~426-623 (detail panel).

- [ ] **Step 1: Add Save button with dirty state tracking**

The panel should:
- Track which fields have changed (`isDirty` flag)
- Show a prominent "Save Changes" button when dirty (green/primary color)
- On Save, PATCH all changed fields to API in one call
- On save success, clear dirty state
- Also auto-save on blur for individual fields (existing behavior, keep it)

- [ ] **Step 2: Replace RACI JSON textarea with 4 separate inputs**

Replace the single RACI (JSON) textarea with:
```
RACI
  Responsible: [text input]
  Accountable: [text input]
  Consulted:   [text input]
  Informed:    [text input]
```

Parse existing RACI JSON on load → populate 4 fields. On save, serialize back to JSON: `{"responsible":"Brian","accountable":"Serge","consulted":"Flannery, Brendan","informed":"Pat"}`.

Handle the double-escaped JSON bug: if `raci` starts with `"`, strip outer quotes before parsing.

- [ ] **Step 3: Add dependency management section**

Below RACI, add two sections:

**"This depends on" (incoming):**
- List edges where `targetId === selectedNode.id` and type is blocks/blocker/depends_on/sequence
- Each row: source node name, edge type dropdown, remove button (X)
- "Add dependency" dropdown at bottom (lists all other nodes)
- On add: POST edge to API

**"Blocks / feeds into" (outgoing):**
- List edges where `sourceId === selectedNode.id`
- Same pattern: target node name, type dropdown, remove button
- "Add" dropdown at bottom

- [ ] **Step 4: Use human-readable labels for status/priority**

Use `statusLabel()` from constants for the status dropdown option text. Use priority colors for visual chips.

- [ ] **Step 5: Commit NodePanel overhaul**

```bash
git add packages/client/src/components/NodePanel.tsx
git commit -m "feat: NodePanel — Save button, RACI fields, dependency management"
```

---

## Task 7: Seed Data Update

**Files:**
- Modify: `packages/server/src/seed.ts`

- [ ] **Step 1: Add dates to all seed nodes**

Based on the `dxd-halo-ops.html` data, add realistic startDate/endDate values:
- Active tasks (in_progress): startDate in past, endDate in near future
- Upcoming tasks (not_started): startDate April-May 2026
- Range: March 2026 - December 2026
- This makes Gantt view populated out of the box

- [ ] **Step 2: Fix budgets for Orcrest and LAPD nodes**

Add realistic budget values for nodes that currently have $0:
- Match values from dxd-halo-ops.html (e.g., 2.4=$50K, 2.2=$5K, 2.5=$30K, 1.18=$50K, 1.19=$100K, etc.)

- [ ] **Step 3: Fix RACI data — store as clean JSON, not double-escaped**

Ensure seed RACI values are stored as single-level JSON strings:
```typescript
raci: JSON.stringify({ responsible: "Brian", accountable: "Serge", consulted: "Flannery", informed: "Pat" })
```
NOT double-stringified.

- [ ] **Step 4: Re-run seed and verify**

```bash
cd packages/server && npx tsx src/seed.ts
```

- [ ] **Step 5: Commit seed data update**

```bash
git add packages/server/src/seed.ts
git commit -m "fix: seed data — add dates, budgets, clean RACI JSON"
```

---

## Task 8: Add Node Modal

**Files:**
- Create: `packages/client/src/components/AddNodeModal.tsx`
- Modify: `packages/client/src/components/TopBar.tsx` (add +NODE button)
- Modify: `packages/client/src/Shell.tsx` (manage modal state)

- [ ] **Step 1: Create AddNodeModal with progressive disclosure**

Modal with fields that appear one at a time as user fills them:
1. Name (always visible)
2. Workstream (appears after name is filled)
3. Priority (appears after workstream)
4. Status (appears after priority)
5. Start/End dates (appear together)
6. Budget (optional)
7. Responsible (optional)

"Create" button at bottom. On create: POST to /api/nodes, add to store, close modal.

- [ ] **Step 2: Add +NODE button to TopBar**

Add a `+` button in the TopBar that triggers the modal. Pass callback via props or use a Zustand flag.

- [ ] **Step 3: Commit**

```bash
git add packages/client/src/components/AddNodeModal.tsx packages/client/src/components/TopBar.tsx packages/client/src/Shell.tsx
git commit -m "feat: Add Node modal with progressive disclosure"
```

---

## Execution Order and Parallelism

```
Task 1 (Foundation) ──────────────────────────── MUST be first
    │
    ├── Task 2 (Graph View)    ─┐
    ├── Task 3 (Board View)     │── All parallelizable (separate files)
    ├── Task 4 (Gantt View)     │
    ├── Task 5 (Budget View)    │
    ├── Task 7 (Seed Data)      │── Independent (backend only, no frontend conflicts)
    └── Task 8 (Add Node Modal) ┘── Only touches AddNodeModal.tsx (new file) + minor TopBar/Shell
    │
    └── Task 6 (NodePanel)     ─── Last (may reference patterns from views)
```

**Notes on parallelism:**
- Tasks 2-5, 7, 8 touch entirely different files and can run simultaneously
- Task 6 (NodePanel) should go last since it may benefit from patterns established in views
- Board view drag-and-drop reordering is OUT OF SCOPE for v1 (can add later)
- All views should import `buildClusterMaps`, `isClusterNode` from constants.ts (not duplicate the logic)

**Estimated total: 8 tasks, 6 parallelizable after foundation.**
