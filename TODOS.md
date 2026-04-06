# TODOS

## Completed

### MCP Transport Error Boundary
- **Completed:** v0.5.0.0 (2026-04-03)
- `app.ts` now wraps the MCP handler in `.catch()` at the Express mount level, returning 500 instead of crashing the process
