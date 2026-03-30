# Changelog

All notable changes to Rome will be documented in this file.

## [0.3.0.1] - 2026-03-30

### Fixed
- MCP OAuth flow: browser tab auto-closing before Claude could complete token exchange (replaced JS redirect + window.close with HTTP 302 redirect)

### Changed
- Gantt view now shows cluster nodes (e.g. KRs) that have start/end dates, not just leaf nodes

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
