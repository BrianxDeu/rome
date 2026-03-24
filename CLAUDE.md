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
- `packages/client` — React 18 + React Flow + Zustand + Vite
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
