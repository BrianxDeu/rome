# TODOS

## MCP Transport Error Boundary
- **What:** Wrap the MCP Streamable HTTP handler in try/catch at the Express mount level in `app.ts`
- **Why:** The `@modelcontextprotocol/sdk` Express integration is relatively new. An unhandled error in the protocol adapter could crash the entire Express server, taking down the REST API and frontend for all users.
- **Pros:** Prevents cascading failure. 3 lines of defensive code.
- **Cons:** None.
- **Context:** Standard Express error handling pattern. Mount the MCP handler inside an Express error-handling middleware wrapper so transport errors return 500 instead of crashing the process. See `app.ts:31-36` for the existing catch-all pattern.
- **Depends on:** MCP connector implementation (must be done during or after MCP mount code is written)
