# Changelog

All notable changes to Rome will be documented in this file.

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
