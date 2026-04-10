# Changelog

All notable changes to Rome will be documented in this file.

## [0.5.3.0] - 2026-04-10

Closes the PKCE bypass found by the rome-auth-auditor droid: POST /oauth/authorize accepted auth codes without proof-of-possession, and non-S256 challenge methods silently skipped verification.

### Fixed
- **PKCE enforced on POST /oauth/authorize** — direct POST requests (bypassing the login form) must now include `code_challenge` with method `S256`. Previously only the GET handler enforced this, leaving a bypass path for auth code interception
- **Reject non-S256 PKCE methods** — `code_challenge_method=plain` or any value other than `S256` is now rejected at both GET and POST authorize endpoints. Previously, non-S256 methods stored a challenge that the token endpoint never verified
- **Service user fallback removed** — token exchange no longer silently falls back to `mcp-service-user-00000000` when userId is missing from the auth code. Returns an explicit 400 error instead
- **HTML-escape OAuth error messages** — `renderAuthorizeForm` now escapes `&`, `<`, `>`, `"` in error strings to prevent future XSS if error messages ever include user-controlled input

## [0.5.2.1] - 2026-04-10

Graph view overhaul: the center node is now the workstream with the most activity (HALO + Orcrist MVP), not a hardcoded OBJ1. All five OBJ workstreams are now visible. Closing a workstream collapses everything inside it. Empty workstreams show at full size.

### Fixed
- **OBJ2-5 invisible in graph** — `isGoalNode` matched all OBJ nodes but only rendered OBJ1; the rest were excluded from every render path. Now only the hub node gets special treatment, others render as structural nodes
- **Hub node selection** — center node is now the structural node with the most descendants (dynamic), not the first OBJ-prefix match (hardcoded)
- **Cascading collapse** — closing a workstream now hides all descendants recursively, including node group children that were previously orphaned on screen
- **Empty workstreams** — workstreams with no children (like "Build a Drone") now render at the same size as populated workstreams instead of appearing as tiny orphan dots
- **Layout grouping** — workstream headers are now positioned at the center of their child group instead of being dumped into a disconnected orphan row

## [0.5.2.0] - 2026-04-09

Three bug fixes: MCP connector stability (Claude Desktop no longer drops after Railway deploys or token expiry), silent date loss in `rome_execute_plan`, and a graph rendering bug that misidentified arbitrary nodes as the central "GOAL" hub.

### Fixed
- **MCP OAuth persistence** — OAuth client registrations and refresh tokens now survive Railway deploys (stored in `oauth_clients` + `oauth_tokens` SQLite tables). Access tokens extended from 1h to 7d; refresh tokens last 30d so Claude Desktop can silently renew without re-authorization
- **PKCE now enforced** — `/oauth/authorize` requires `code_challenge` on all requests; public clients have no `client_secret` so PKCE is the sole proof-of-possession
- **`rome_execute_plan` date fields** — `startDate`/`endDate` (camelCase) now auto-normalize to `start_date`/`end_date` before validation; dates were previously silently dropped when Claude used natural camelCase
- **Graph `isGoalNode` mismatch** — goal node detection now matches the explicit `OBJ\d+:` prefix convention instead of substring-matching "goal"/"mission", which caused unrelated task nodes to be rendered as the central hub with a "GOAL" label
- **Orphan nodes in graph** — nodes with no workstream (null) are now placed in a row below center instead of colliding with the goal node at (0,0)
- **Security hardening** (from earlier commits on branch): removed `ensureUser` auto-provisioning, dropped static MCP token, pinned GitHub Actions to SHA, container runs as non-root, OAuth redirect\_uri validation, registration cap



Three fixes from QA sprint: cascade-delete children when deleting a parent node (prevents orphans), MCP tools now use the authenticated user ID instead of a hardcoded service account, and Socket.IO reconnects automatically refetch the graph to prevent stale state.

### Fixed
- Deleting a node now cascade-deletes all descendant nodes (children, grandchildren) via parent_of edges, preventing orphaned nodes
- MCP tools (`rome_update_node`, `rome_create_edge`, `rome_create_node_group`) now use the authenticated userId from the JWT instead of hardcoded `mcp-service-user-00000000`
- Socket.IO reconnects now trigger a full graph refetch so clients don't see stale data after network interruptions

## [0.5.1.0] - 2026-04-06

Visual overhaul targeting the shadcn Luma aesthetic. Every view now renders in Montserrat on a warm stone background with white floating cards. The font is controlled by a single CSS variable, so switching fonts is a one-line change.

### Changed
- Primary font switched from Tomorrow to Montserrat Variable across all views, modals, and panels
- App background changed from pure white to warm stone (#F5F4F2), cards are white on stone
- All card border-radius unified to 8px, chips/badges to 4px
- Navigation tabs, buttons, and labels changed from ALL CAPS to Title Case (logo stays uppercase)
- Minimum font size raised from 8px to 10px across Gantt bars, Board chips, Budget fills
- TopBar buttons get 6px border-radius and consistent styling
- Login card gets box-shadow for depth on stone background
- +Node / +Group / +Stream buttons now visible on Tasks view

### Removed
- Board card left-border accent strips (AI slop pattern)
- Kanban status-colored left-borders on in_progress and blocked cards
- All hardcoded `font-family: Tomorrow` in Tailwind classes and inline styles (40+ occurrences)

## [0.5.0.0] - 2026-04-03

Two new capabilities: a Kanban board view and an AI-native write pipeline via MCP. You can now move tasks between status columns with drag-and-drop, and tell Claude to update the project graph in bulk — with transactional guarantees, receipts, and a full audit trail.

### Added
- **Kanban view** — new tab showing tasks organized into Not Started / In Progress / Blocked / Done columns. Drag cards between columns to change status, drag within a column to reorder. Sidebar filters by workstream and node group. Sort order persists to the database.
- **`rome_execute_plan` MCP tool** — execute a batch of create/update/edge operations in a single BEGIN IMMEDIATE transaction. Returns per-operation receipts with before/after values. Self-verifies after commit; rolls back the entire transaction if verification fails.
- **`rome_audit_trail` MCP tool** — query a persistent log of all MCP write operations. Filter by timestamp, tool name, user, or node ID. Answers "what changed today?" in under 2 seconds.
- **Audit logging on existing MCP tools** — `rome_create_task`, `rome_update_node`, `rome_create_node_group`, `rome_create_edge` now write audit entries on every call.
- **Brain dump workflow** — `rome_get_graph` description updated to guide Claude through the full brain-dump flow: get graph → semantic match → present plan → execute via `rome_execute_plan`.
- **`audit_log` table** — new SQLite table storing tool name, user, affected node IDs, before/after JSON, verification result, and timestamp.

### Fixed
- `rome_audit_trail` scoped to caller's own user by default (prevents cross-user data exposure)
- `audit_log` timestamps stored in SQLite format so `since` filter comparisons work correctly
- Kanban drag-over border artifact on cancelled drags (Escape key now cleans up indicators)
- Kanban partial persist failure triggers graph refetch to reconcile optimistic state

## [0.4.1.1] - 2026-04-03

Tasks view now scrolls when you have more tasks than fit on screen.

### Fixed
- Tasks view clipped by parent overflow:hidden — added scroll container so long task lists are reachable

## [0.4.1.0] - 2026-03-31 — Security Hardening

Locks down auth, OAuth, and MCP for production use. JWT secret fallback removed (server requires env var). Login rate limiting active. Registration gated by env var. OAuth validates redirect URIs and issues per-session JWTs. MCP accepts both new JWTs and legacy static tokens. Socket.IO CORS restricted to production domain. npm audit vulnerabilities patched.

### Changed
- JWT secret fallback `"rome-dev-secret"` removed, server fails fast if `JWT_SECRET` env var is missing
- Admin seed password randomized via `crypto.randomBytes` instead of hardcoded `password123`
- OAuth `/oauth/token` issues per-session JWTs (1h expiry) instead of returning static `MCP_AUTH_TOKEN`
- OAuth `/oauth/authorize` validates `redirect_uri` against registered client URIs
- MCP auth accepts both per-session JWTs and legacy `MCP_AUTH_TOKEN` for backwards compatibility
- Socket.IO CORS restricted from `*` to production domain + localhost
- Vite proxy port configurable via `API_PORT` env var

### Added
- Rate limiting on `/api/auth/login` and `/api/auth/register` (10 attempts per 15 minutes)
- Registration gate via `REGISTRATION_ENABLED` env var (defaults to disabled)
- 19 security regression tests covering auth, OAuth, rate limiting, and infrastructure
- CLAUDE.md self-update rule for Known Gotchas section

### Fixed
- npm audit: patched `path-to-regexp` (ReDoS) and `brace-expansion` (hang)

## [0.4.0.0] - 2026-03-30 — Archive View

Completed workstreams now auto-archive after 24 hours, clearing clutter from active views. The new ARCHIVE button shows who completed each task, when, and lets you restore workstreams if work turns out to be incomplete. Accountability for DxD, built in.

### Added
- **Archive view** with expandable workstream cards showing task completion metadata (who, when, status, budget)
- **ARCHIVE button** in TopBar far-right group, red when active
- **Completion tracking**: `completedBy` and `completedAt` fields auto-set when a node's status changes to "done"
- **Auto-archive**: workstreams where all tasks are done for 24+ hours are archived on next page load via `POST /api/archive/check`
- **Restore**: one-click unarchive puts a workstream back in all active views
- **`graph:refetch` Socket.IO event** for cross-client sync when workstreams are archived or restored
- Archived nodes filtered from Graph, Board, Gantt, and Budget views
- NodePanel accessible from archive view for inspecting/editing archived nodes
- Migration backfills `completedAt` from `updatedAt` for pre-existing done nodes

## [0.3.1.1] - 2026-03-30

### Fixed
- Board card text fields (notes, deliverables, RACI, budget) now auto-save as you type instead of only on blur, preventing data loss when switching between cards

## [0.3.1.0] - 2026-03-30

### Added
- Drag-reorder workstreams in Board view: grab a collapsed workstream header and drop it to rearrange, persisted across sessions
- `sort_order` column on nodes for persistent ordering
- Gantt view: hierarchical display with collapsible workstreams and node groups
- Gantt view workstreams start collapsed by default with chevron toggle

### Changed
- Workstream colors are now derived from name hash, so they stay stable when reordered

### Fixed
- Gantt view now shows cluster nodes (e.g. KRs) that have start/end dates, not just leaf nodes

## [0.3.0.1] - 2026-03-30

### Fixed
- MCP OAuth flow: browser tab auto-closing before Claude could complete token exchange (replaced JS redirect + window.close with HTTP 302 redirect)

## [0.3.0.0] - 2026-03-27

### Added
- Personal Tasks view — per-user ephemeral task list with priority (P0-P3) and 60-second auto-delete after checking off
- Tasks tab is now the default landing view (leftmost tab)
- Socket.IO per-user rooms for cross-tab task sync
- Server-side stale task cleanup every 5 minutes
- Delete workstream capability (✕ button on workstream headers in Board view)
- MCP request logging for debugging

### Fixed
- Budget Items table empty on "All Workstreams" default filter
- Delete buttons now require confirmation before destroying data
- Duplicate tasks from Socket.IO echo (race condition between API response and socket event)
- Workstream rename now cascades to all child nodes' workstream field (prevents orphaned phantom workstreams)
- MCP connection stability: graceful shutdown on deploy, token expiry extended to 7 days, error boundary around handler
- SQLite datetime format mismatch in stale task cleanup query

## [0.2.0.0] - 2026-03-26

### Added
- Board view with collapsible node groups, drag-and-drop, inline card editing
- Graph view with SVG nodes, edges, pan/zoom, cluster expand/collapse, selection dimming
- Gantt view with 4 time scales (week/month/quarter/year), colored bars, today line
- Budget view with hero total, workstream bar chart, priority table, inline budget editing
- Detail panel with RACI, dependency management, status/priority/dates editing
- Add Node wizard (5-step: Name → Parent → Priority → Dates → Budget/Owner)
- Add Node Group and Add Workstream modals
- JWT authentication with login/register
- Socket.IO real-time sync for nodes and edges
- MCP connector with 4 tools (create_task, get_graph, update_task, status_report)
- Railway deployment with SQLite volume persistence
