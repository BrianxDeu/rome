# Rome

In-house project management software for DxD (5-10 users).

## CRITICAL SAFETY RULES — READ BEFORE ANY CHANGES

**These rules are non-negotiable. Every agent (polecat, mayor, subagent) must follow them.**

### Data Protection
- **NEVER delete, reset, or re-seed `rome.db`** — it contains live project data
- **NEVER run `DROP TABLE`** or truncate any table
- **NEVER re-run `seed.ts`** on a DB that already has data (check first)
- **NEVER delete nodes or edges in bulk** — only delete individual items when explicitly asked
- The `migrate-v2.ts` script is idempotent but should only be run when instructed

### Frontend Changes Don't Touch Data
- Changing React components, styles, or views must NOT affect the database
- Frontend deploys are safe — the backend + DB are separate
- If you need test data, use the API to create it — don't modify the DB directly

### What You CAN Do Safely
- Modify any file in `packages/client/src/` (frontend code)
- Modify route handlers in `packages/server/src/routes/` (API logic)
- Add new API endpoints
- Run `npm install` to add dependencies
- Run typecheck and build commands

### Before Committing
- Run `npx tsc --noEmit -p packages/client/tsconfig.json` to verify no type errors
- Check that the dev server still works (`curl http://localhost:5173`)
- Do NOT commit `rome.db`, `rome.db-wal`, or `rome.db-shm`

## Architecture

npm workspaces monorepo:
- `packages/shared` — TypeScript types and Drizzle ORM schema (camelCase field names)
- `packages/server` — Express API + Socket.IO + SQLite via Drizzle ORM + MCP server (6 tools)
- `packages/client` — React 19 + Custom SVG Graph + Zustand + Vite + Tailwind v4 + shadcn/ui
- `packages/cli` — Commander.js CLI wrapping REST API

Design spec: `rome/crew/brian/docs/specs/2026-03-23-rome-design.md`
Implementation plan: `docs/plans/2026-03-23-rome-implementation.md`

## Development

```bash
npm install
npm run build --workspace=packages/shared  # Build shared types FIRST
npm run dev --workspace=packages/server     # Backend on :3000
npm run dev --workspace=packages/client     # Frontend on :5173 (proxies to :3000)
```

## Definition of Done

```bash
npm run build --workspace=packages/shared
npm run typecheck --workspace=packages/server
npm run typecheck --workspace=packages/client
npm run test --workspace=packages/server
```

## DxD Brand

- Font: Tomorrow (Google Fonts)
- Primary accent: #B81917 (red)
- Background: #FFFFFF (white)
- Text: #1A1A1A
- Secondary gray: #414042

## Known Gotchas — DO NOT REPEAT

### API field naming: snake_case in API, camelCase in TypeScript
- The edge creation endpoint expects `source_id` / `target_id` (snake_case)
- Drizzle schema and shared types use `sourceId` / `targetId` (camelCase)
- The server `toEdgeJson()` converts between them
- **Always check the Zod schema** in the route file to know what the API expects
- When piping curl to /dev/null, you lose error responses — always check return values

### Socket.IO vs native WebSocket
- Server uses Socket.IO (`socket.io`), NOT native WebSocket
- Client MUST use `socket.io-client`, NOT `new WebSocket()`
- Event names from server are `node:created`, `node:updated`, `node:deleted`, `edge:created`, `edge:deleted` (past tense)

### Store must be populated on mount
- `useSync` only handles real-time deltas via WebSocket
- `useGraph` hook fetches initial data from `GET /api/graph`
- Both hooks must be called in Shell.tsx — sync alone = empty graph

### Status values
- Valid: `not_started`, `in_progress`, `blocked`, `done`, `cancelled`
- NOT: `active`, `completed`, `deferred` — these are wrong and break status colors/filters

### Graph node positions
- Nodes without x/y need deterministic layout, NOT `Math.random()`
- Random positions cause nodes to scatter invisibly and change every render
- Use `computeLayout()` for stable grid positions grouped by workstream

### Filters store key naming
- Use `workstream` not `type` for the workstream filter key
- The Filters interface must match what FilterBar sets and matchesFilter reads

### Build shared before client
- `@rome/shared` must be built (`tsc`) before client can typecheck
- The client imports from `@rome/shared` which resolves to `dist/`

### Always verify with real API calls
- Don't assume edge creation succeeded just because curl returned — check the response
- Test the full path: API → DB → fetch → store → render

### SVG pointer-events
- Overlay rects (workstream boxes, cluster backgrounds) MUST have `pointer-events: none`
- Without this, they intercept clicks on nodes beneath them
- The graph-bg rect also needs `pointer-events: none`

### Board add-node reactivity
- After creating a node + parent_of edge via API, **always refetch `/api/graph`** to update the store
- Individual `addNode` + `addEdge` calls don't trigger `buildClusterMaps` recalculation in the same render cycle
- This applies to NodePanel edge add/remove too — must refetchGraph() after edge operations

### Workstream header identification — THE CRITICAL PATTERN
- Ws headers have `workstream: null` in the database (NOT `workstream: "their own name"`)
- `isWsHeader` check: `!parentMap.has(n.id) && !isGoalNode(n) && !n.workstream`
- To find a ws header by workstream name: `nodes.find(n => n.name === wsName && !parentMap.has(n.id) && !n.workstream)`
- The Board derives workstream names from leaf node `workstream` fields AND from top-level parentless node names
- `isClusterNode(id, childrenMap)` only returns true for nodes WITH children — empty new node groups fail this check
- Node groups that are children of ws headers must be tracked via `nodeGroupIds` set and excluded from `leafNodes`
- Board cluster detection must check BOTH: (1) parents of leaf nodes AND (2) direct children of the ws header

### Zod boolean validation is strict
- `z.boolean()` only accepts `true`/`false`, NOT `1`/`0`
- Sending `position_pinned: 1` instead of `position_pinned: true` causes silent PATCH failure
- The `.catch(() => {})` pattern swallows these errors — always log: `.catch((err) => console.error(...))`

### Graph position persistence — stale closure bug
- On drag end, use coordinates from the drag state ref (`ds.lastX`/`ds.lastY`), NOT from `posMap.get(id)`
- `posMap` is rebuilt from `computeLayout()` on each React render — the closure captures the pre-drag positions
- **Group drag**: capture all descendant start positions at mousedown into `descendantStarts` map
- Apply `startPos + totalDelta` on each frame, NOT frame-by-frame deltas (which get overwritten by computeLayout)
- Only drag descendants when the parent is COLLAPSED — expanded parents move alone

### Auto-edge creation on node/group creation
- When creating a task under a node group: create `parent_of` edge (group → task) AND `produces` edge (task → group)
- When creating a node group under a workstream: create `parent_of` edge (ws → group) AND `produces` edge (group → ws)
- The `produces` edges make arrows visible in the Graph view — without them nodes appear disconnected

### Physics simulation — abandoned, lessons learned
- d3-force physics was attempted and abandoned — nodes collapsed on drag, anchors made it indistinguishable from static
- The d3-force package is still installed but unused — can be removed
- **Decision: static layout only.** computeLayout() + drag + collapsible clusters is the current approach

### Socket.IO echo causes duplicates
- When creating data via API, the server broadcasts a Socket.IO event to ALL sockets in the user's room, INCLUDING the socket that triggered the request
- The API response callback and the socket event handler BOTH try to add the item to state
- React state batching means the dedup check in the socket handler may not see the item added by the API callback yet
- **Fix pattern**: use a `ref` (not state) to track known IDs synchronously. Check the ref in BOTH the API callback and the socket handler before adding to state. See `TasksView.tsx` `knownIdsRef` for the pattern
- This applies to ANY feature that creates data via API + receives socket events

### Workstream rename must cascade to children
- Workstream headers are nodes whose `name` field determines the workstream grouping
- Child nodes have a `workstream` field that must MATCH the parent header's `name`
- When renaming a workstream header, the server MUST update all children's `workstream` field to the new name
- If you only rename the header node, children keep the old name and appear as phantom workstreams
- The server PATCH route in `nodes.ts` handles this cascade automatically now
- **Never rename a workstream header client-side only** — always go through the API

### Deleting nodes with children requires recursive deletion
- Deleting a workstream header or node group does NOT auto-delete child nodes (only edges cascade via foreign keys)
- You must delete leaf nodes first, then node groups, then the header — bottom-up
- If you delete a parent without deleting children, children become orphans and appear as their own workstreams
- The Board view delete handlers do this correctly — follow the same pattern

### SQLite datetime format matters
- Store timestamps as `YYYY-MM-DD HH:MM:SS` (SQLite format), NOT JavaScript's `toISOString()` which produces `YYYY-MM-DDTHH:MM:SS.sssZ`
- SQLite's `datetime()` function returns the space-separated format
- Lexicographic comparison between the two formats does NOT work correctly
- Use `.replace("T", " ").replace(/\.\d+Z$/, "")` when storing timestamps that will be compared with `datetime()`

### Railway deploy behavior
- Every push to main triggers a deploy (via sync workflow to BrianxDeu/rome)
- Railway sends SIGTERM to the old container, then starts the new one
- Don't call `process.exit()` in SIGTERM handlers — Railway interprets it as a crash and sends "Deploy Crashed" emails
- Just close the HTTP server and let Railway manage the process lifecycle
- Active MCP/Socket.IO connections are severed on deploy — there's no way around this without persistent sessions

### MCP connection stability
- MCP OAuth tokens expire in 7 days (matches user JWT expiry)
- MCP handler has an error boundary in `app.ts` that catches unhandled exceptions
- MCP tool errors are logged to console — check Railway logs when debugging disconnections
- OAuth codes and client registrations are stored in-memory (lost on every deploy)
- If MCP disconnects, the most likely cause is a Railway deploy that killed the connection

### CSS specificity: index.css beats Tailwind classes on nested elements
- `index.css` has selectors like `.board-card-body textarea` (specificity 0,1,1)
- Tailwind utility classes like `min-h-28`, `px-3.5` have specificity (0,1,0)
- **The old CSS always wins** — Tailwind changes on components inside these selectors are silently ignored
- **Fix**: when styling shadcn components (Input, Textarea, etc.), either:
  1. Remove the conflicting properties from `index.css` (preferred), or
  2. Use inline `style={{ }}` on the component (guaranteed to override), or
  3. Never rely on Tailwind classes for properties already set by `index.css` descendant selectors
- Before changing any visual property via Tailwind, `grep` for that property in `index.css` to check for conflicts
- The `.board-card-body textarea`, `.dp-input`, `.dp-textarea` rules are the main offenders

### Always use feature branches for production changes
- Never push hotfixes directly to main — use `git checkout -b fix/whatever`, then `/ship` + `/land-and-deploy`
- The `/ship` workflow runs tests, code review, and adversarial review that catch bugs localhost misses
- Direct-to-main pushes skip all safety checks and have caused production bugs

## Current State (v0.3.0.0, 2026-03-27)

### What's Built
- **5 views**: Tasks (default landing), Board, Graph (custom SVG), Gantt (bars + today line), Budget (hero + tables)
- **Tasks**: Per-user private task list with P0-P3 priority, auto-delete 60s after checking off, Socket.IO cross-tab sync
- **Board**: Node groups (cluster sub-headers), drag-and-drop within/between groups, inline card editing, add node/add node group, delete workstream, delete confirmation dialogs
- **Graph**: Collapsible cluster nodes, workstream dashed boxes, selection dimming, edge lines, pan/zoom, FIT button
- **Gantt**: 4 time scales (week/month/quarter/year), colored bars by priority, today line, detail panel
- **Budget**: Hero total, workstream bar chart, priority table (respects workstream filter), sortable/filterable items table with inline budget editing
- **Detail Panel**: RACI (4 fields), dependency management (add/remove edges), status/priority/dates/budget editing
- **TopBar**: DXD HALO OPS branding, Tasks/Board/Graph/Gantt/Budget tabs, +NODE/+GROUP/+STREAM/SHARE/LOGOUT buttons
- **API**: Full CRUD for nodes/edges/personal tasks, graph endpoint, budget rollup, auth (JWT), Socket.IO real-time sync with per-user rooms
- **MCP**: 6 tools (rome_get_graph, rome_create_task, rome_create_node_group, rome_create_edge, rome_update_node, rome_status_report), OAuth auth, error boundary, request logging
- **Deployment**: Live at rome-production.up.railway.app, auto-deploy on push to main

### Data Model
- `nodes` table: workstream headers, node groups, leaf task nodes
- `edges` table: parent_of, blocks, blocker, depends_on, sequence, produces, feeds, shared (cascade delete on edges)
- `personal_tasks` table: per-user ephemeral tasks with priority and auto-cleanup
- `users` table: JWT auth with login/register
- Parent-child hierarchy: workstream header → node group → leaf nodes (via parent_of edges)
- RACI stored as JSON in `raci` field — parseRaci() handles both short (R/A/C/I) and full keys, plus arrays
- Workstream rename cascades: server PATCH updates children's `workstream` field automatically

### What Still Needs Work
1. **Graph view**: Still too spread out. Needs tighter layout, more Obsidian-like
2. **Cross-view sync**: Mostly works via Zustand store, but some operations need full refetch
3. **MCP session persistence**: OAuth codes/client registrations are in-memory (lost on deploy)

### Reference Files (User's Original Design)
The frontend was ported from these single-file HTML apps:
- `dxd-halo-ops.html` — 4-view app (Board, Graph, Gantt, Budget) with clusters, board drag-drop, PeerJS collab
- `dxd-graph-pm.html` — Graph-only view with groups, minimap
- User preference: COPY reference code directly, don't rebuild from scratch

### Key People
- Brian Sullivan (PM) — primary user, coordinates everything
- Serge — cUAS & R&D Lead, thinks in webs/connections
- Scott — hardware/testing
- Pat — CEO, needs investor-grade presentations

## Deploy Configuration (configured by /setup-deploy)
- Platform: Railway (Dockerfile builder)
- Production URL: https://rome-production.up.railway.app
- Deploy repo: BrianxDeu/rome (mirrored from bsulee/rome via GitHub Actions)
- Deploy workflow: Auto-deploy on push to main (Railway watches BrianxDeu/rome)
- Deploy chain: push to bsulee/rome → sync workflow mirrors to BrianxDeu/rome → Railway auto-deploys
- Merge method: squash
- Project type: web app (Express API + React SPA)
- Post-deploy health check: https://rome-production.up.railway.app/health

### Custom deploy hooks
- Pre-merge: `npm run build --workspace=packages/shared && npm run typecheck --workspace=packages/server && npm run typecheck --workspace=packages/client && npm run test --workspace=packages/server`
- Deploy trigger: automatic on push to main (via Railway)
- Deploy status: poll https://rome-production.up.railway.app/health
- Health check: https://rome-production.up.railway.app/health
- SQLite persistence: Railway volume mounted at /data (DATABASE_PATH=/data/rome.db)
