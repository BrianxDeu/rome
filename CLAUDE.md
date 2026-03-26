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
- `packages/server` — Express API + Socket.IO + SQLite via Drizzle ORM
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
- After creating a node + parent_of edge via API, refetch `/api/graph` to update the store
- Individual `addNode` + `addEdge` calls don't trigger `buildClusterMaps` recalculation in the same render cycle

## Current State (2026-03-25)

### What's Built
- **4 views**: Board (primary), Graph (custom SVG), Gantt (bars + today line), Budget (hero + tables)
- **Board**: Node groups (cluster sub-headers), drag-and-drop within/between groups, inline card editing, add node/add node group
- **Graph**: Central goal node ("Mission: Ukraine MVP"), collapsible cluster bars, workstream dashed boxes, selection dimming, edge lines, pan/zoom
- **Gantt**: 4 time scales (week/month/quarter/year), colored bars by priority, today line, detail panel in-place
- **Budget**: Hero total, workstream bar chart, priority table, sortable/filterable items table with inline budget editing
- **Detail Panel**: RACI (4 fields), dependency management (add/remove edges), status/priority/dates/budget editing
- **TopBar**: DXD HALO OPS branding, Board/Graph/Gantt/Budget tabs, +NODE/+STREAM/SHARE/LOGOUT buttons
- **API**: Full CRUD for nodes/edges, graph endpoint, budget rollup, auth (JWT), Socket.IO real-time sync
- **shadcn/ui**: Installed (14 components) but only partially integrated — TopBar uses original CSS classes
- **Deployment**: GitHub Actions auto-sync from bsulee/rome → BrianxDeu/rome, Railway config ready

### Data Model
- 38 nodes: 1 goal + 3 workstream headers (HALO MVP, ORCREST, LAPD) + 6 cluster parents (Hardware Tech Stack, Warhead Program, Ukraine Ops, Testing Campaign, Ops & PM, BD & Relationships) + 28 leaf task nodes
- Parent-child relationships via `parent_of` edges
- Dependency edges: blocks, blocker, depends_on, sequence, produces, feeds, shared
- RACI stored as JSON in `raci` field — parseRaci() handles both short (R/A/C/I) and full keys, plus arrays

### What Still Needs Work
1. **Graph view**: Still too spread out. Needs tighter layout, more Obsidian-like. Node groups should cluster closer to center.
2. **Cross-view sync**: Changes in Board should instantly reflect in Graph/Gantt/Budget (mostly works via Zustand store, but some operations need full refetch)
3. ~~**Deployment**: Railway project needs to be created and connected to BrianxDeu/rome~~ — DONE, live at rome-production.up.railway.app

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
