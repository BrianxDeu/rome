# Graph View Rebuild — Spec

## Context

The original Graph view was disabled (`94eb21a`) due to:
- Layout was vertically stacked, not web-like (Obsidian-style)
- Dependency edge lines were barely visible or flew off-screen
- No useful interaction (clicking nodes, adding edges)
- Overall not visually appealing or functional

The Graph tab has been removed from the TopBar. `GraphView.tsx` and `NodePanel.tsx` are preserved as reference but should be rewritten.

## What We Want

An **Obsidian-style graph view** — a force-directed network visualization where:
- Nodes are circles/pills connected by lines
- Related nodes cluster together organically
- You can drag nodes, zoom, pan
- Clicking a node shows its details
- Dependency edges (blockers, depends_on) are visible lines with directionality
- Parent-child relationships show as workstream grouping (dashed boxes or proximity)

## Data Model

- **39 nodes** across 3 workstreams: HALO MVP (15), ORCRIST (15), LAPD (9)
- **~40 edges**: mostly `parent_of` (hierarchy), plus `depends_on`, `blocker` (dependencies)
- Node fields: name, workstream, status, priority, startDate, endDate, budget, raci, deliverable, notes
- Edge types: `parent_of`, `blocks`, `blocker`, `depends_on`, `sequence`, `produces`, `feeds`, `shared`

## Requirements

### Layout
1. Force-directed or physics-based — nodes repel each other, edges pull connected nodes together
2. Workstream nodes cluster by proximity (not rigid boxes)
3. Fits in viewport on load — no massive empty canvas
4. Nodes can be dragged and positions persist (PATCH /nodes/:id with x, y)
5. Pan and zoom via mouse wheel + click-drag on background

### Node Rendering
- Small circles (6-10px radius) colored by priority or status
- Label text below each node
- Cluster parent nodes (Hardware Tech Stack, Testing Campaign, etc.) rendered as larger pills with expand/collapse
- When collapsed: pill shows name + child count
- When expanded: children fan out around parent

### Edge Rendering
- `parent_of` edges: subtle gray lines or no lines (use proximity grouping instead)
- Dependency edges: colored lines with arrowheads
  - Red: `blocks` / `blocker`
  - Amber dashed: `depends_on`
  - Blue: `sequence`
  - Gray: `produces`, `feeds`, `shared`
- Edges should be visible at default zoom (opacity 0.5+, width 1.5px+)

### Interaction
- Click node → select it, show detail panel (reuse NodePanel.tsx pattern)
- Selection dims unconnected nodes (opacity 0.15-0.2)
- Click background → deselect
- Drag node → move it (persist position on mouseup)
- Scroll → zoom in/out
- Click-drag background → pan

### Integration
- Add GRAPH tab back to TopBar
- Render in Shell.tsx when activeView === "graph"
- Show NodePanel when a node is selected in graph
- Store state in graphStore.ts (nodes, edges, selectedNode, collapsed)
- "VIEW IN GRAPH" button on Board cards navigates to graph and selects the node

## Technical Approach Options

### Option A: d3-force (recommended)
- Use `d3-force` for physics simulation + custom React SVG rendering
- `d3-force` handles: collision detection, link forces, centering, clustering
- React handles: SVG rendering, interaction handlers, state
- Well-documented, battle-tested, handles our scale (40 nodes) easily
- `npm install d3-force @types/d3-force`

### Option B: reactflow
- Full-featured React graph library
- Built-in pan/zoom, node dragging, edge routing
- Heavier dependency but does everything out of the box
- May be over-engineered for our needs (40 nodes, simple rendering)

### Option C: Custom SVG (what we had)
- Pure React SVG with manual positioning
- Maximum control but we already proved this doesn't work well
- No physics simulation means manual layout forever

## Reference

- Old GraphView.tsx: `packages/client/src/pages/GraphView.tsx` (disabled, preserved)
- Old NodePanel.tsx: `packages/client/src/components/NodePanel.tsx` (preserved)
- Graph CSS: `packages/client/src/index.css` (canvas-area, graph-node classes)
- API: `GET /api/graph` returns `{ nodes: Node[], edges: Edge[] }`
- Store: `packages/client/src/stores/graphStore.ts`
- User's design reference: `dxd-halo-ops.html` and `dxd-graph-pm.html` in crew/brian/

## DxD Brand
- Font: Tomorrow
- Primary accent: #B81917 (red)
- Text: #1A1A1A
- Muted: #999 / #414042
- Surface: #F5F5F5 / #F8F8F8
