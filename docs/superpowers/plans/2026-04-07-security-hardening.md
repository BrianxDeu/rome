# Security Hardening Plan — CSO Audit Remediation

**Date:** 2026-04-07
**Branch:** `fix/security-hardening-v2`
**Audit source:** `.gstack/security-reports/2026-04-07-163500.json`
**Goal:** Fix all 8 findings from the April 7 CSO audit without breaking existing functionality.

## Architecture Context

- Express API at `packages/server/src/app.ts` serves both REST routes and MCP OAuth endpoints
- MCP server at `packages/server/src/mcp/server.ts` handles Claude Desktop tool calls
- Auth middleware at `packages/server/src/middleware/auth.ts` — JWT-based, `requireEnv("JWT_SECRET")`
- Users table has `role` column (`admin` | `member`), `requireAdmin` middleware exists but is unused
- The OAuth flow is used by Claude Desktop to connect to MCP. It currently auto-approves without login.
- SQLite DB at `/data/rome.db` on Railway volume. 5-10 internal users.
- 106 tests in `packages/server/src/test/` — all must pass after changes.

## Parallel Task Groups

Five independent workstreams. Each touches different files, no merge conflicts between them.

---

### Task 1: OAuth Flow Hardening (Findings #1, #2, #4)

**Files:** `packages/server/src/app.ts`
**Severity:** CRITICAL

The OAuth flow (`/oauth/authorize`, `/oauth/register`, `/oauth/token`) currently allows any unauthenticated internet user to obtain a valid MCP JWT in 3 curl commands. Three interrelated fixes:

#### 1a. Add login gate to `/oauth/authorize` (Finding #1)

The authorize endpoint currently auto-approves with no user authentication. `req.auth?.userId` is always `undefined` because no auth middleware runs, so every OAuth code carries `userId: undefined`, which becomes `mcp-service-user-00000000` at token exchange.

**Fix:** Replace the auto-approve redirect with an inline login form. When the user submits valid credentials (username + password), issue the code with THAT user's real `userId`.

**Implementation at `app.ts:72-111`:**

1. On `GET /oauth/authorize`, instead of immediately generating a code and redirecting:
   - If the request has NO valid credentials, return a minimal HTML login form. The form POSTs back to `/oauth/authorize` with all the original query params (redirect_uri, state, code_challenge, code_challenge_method, client_id) as hidden fields plus username + password fields.
   - Style the form simply: centered card, "Authorize MCP Access" title, username/password inputs, "Approve" button. Use inline styles (no external CSS needed).

2. Add `POST /oauth/authorize` handler. This receives the form submission:
   - Extract `username` and `password` from `req.body`
   - Look up the user in the DB: `db.select().from(users).where(eq(users.username, username)).get()`
   - Verify password with `bcrypt.compare(password, user.passwordHash)`
   - If invalid: re-render the login form with an error message ("Invalid credentials")
   - If valid: generate the code with `userId: user.id` (NOT `undefined`), redirect to `redirect_uri` with code + state

3. The `GET /oauth/authorize` endpoint needs `express.urlencoded({ extended: false })` middleware for the POST handler to parse form data. Add it only on that route.

4. **The `db` reference:** `createApp` already receives `db` as a parameter. Pass it to the OAuth handlers. Import `users` from `@rome/shared/schema`, `bcrypt` from `bcrypt`, and `eq` from `drizzle-orm` at the top of `app.ts`.

**Key constraint:** Claude Desktop opens `/oauth/authorize` in a browser tab. The user sees the login form, enters their Rome credentials, clicks Approve, and the flow continues. This matches the standard OAuth pattern and doesn't break anything.

#### 1b. Always validate `redirect_uri` (Finding #2)

The redirect_uri validation at `app.ts:80` is wrapped in `if (client_id) { ... }`. When `client_id` is omitted, any URL is accepted.

**Fix at `app.ts:80-89`:**

1. Make `client_id` required. If no `client_id` is provided, return `400 { error: "client_id required" }`.
2. Look up the client in `_oauthClients`. If not found, return `400 { error: "Unknown client_id" }`.
3. Validate `redirect_uri` against the client's registered `redirect_uris`. If no match, return `400 { error: "Invalid redirect_uri" }`.
4. Apply this validation in BOTH the GET (form render) and POST (form submit) handlers.

#### 1c. Rate-limit and cap `/oauth/register` (Finding #4)

`POST /oauth/register` has no auth and no limit on how many clients can be registered.

**Fix at `app.ts:114-130`:**

1. Add a cap: if `_oauthClients.size >= 50`, return `429 { error: "Client registration limit reached" }`. This prevents unbounded memory growth while allowing plenty of legitimate clients.
2. Add rate limiting: reuse or create a limiter — 5 registrations per 15 minutes per IP. Import and apply `rateLimit` from `express-rate-limit`.
3. Keep registration unauthenticated (Claude Desktop needs to register before it has credentials), but these limits prevent abuse.

#### Tests for Task 1

Add tests in a new file `packages/server/src/test/oauth.test.ts`:
- `GET /oauth/authorize` without client_id → 400
- `GET /oauth/authorize` with valid client_id → returns HTML login form (check for `<form` in response body)
- `POST /oauth/authorize` with valid credentials → 302 redirect with code param
- `POST /oauth/authorize` with bad password → returns form with error
- `POST /oauth/token` with code from authenticated flow → JWT with real userId (not mcp-service-user-00000000)
- `POST /oauth/register` → 201, returns client_id
- `POST /oauth/register` 51 times → 50th succeeds, 51st returns 429

---

### Task 2: Dockerfile Non-Root User (Finding #3)

**Files:** `Dockerfile`
**Severity:** HIGH

The production container runs as root. If RCE is achieved, the attacker has root access to the mounted SQLite volume.

**Fix:** Add a non-root user to the runtime stage of the Dockerfile.

**Implementation:**

After the `RUN npm ci --omit=dev` line (line 35) and before the `COPY --from=build` lines, add:

```dockerfile
# Run as non-root user
RUN addgroup --system --gid 1001 rome && \
    adduser --system --uid 1001 --ingroup rome rome
```

After the `RUN mkdir -p /data` line (line 43), add:

```dockerfile
RUN chown -R rome:rome /data
USER rome
```

The full runtime stage becomes:
```
FROM node:20-slim AS runtime
WORKDIR /app
COPY package.json package-lock.json ./
...
RUN npm ci --omit=dev
RUN addgroup --system --gid 1001 rome && \
    adduser --system --uid 1001 --ingroup rome rome
COPY --from=build /app/packages/shared/dist packages/shared/dist
COPY --from=build /app/packages/server/dist packages/server/dist
COPY --from=build /app/packages/client/dist packages/client/dist
RUN mkdir -p /data && chown -R rome:rome /data
ENV DATABASE_PATH=/data/rome.db
ENV PORT=3000
EXPOSE 3000
USER rome
CMD ["node", "packages/server/dist/index.js"]
```

**Key constraint:** Railway's volume is mounted at `/data`. The `chown` ensures the `rome` user can write to it. The node process no longer runs as root.

No tests needed — this is infrastructure-only.

---

### Task 3: Pin GitHub Actions Checkout (Finding #5)

**Files:** `.github/workflows/sync-to-company.yml`
**Severity:** MEDIUM

`actions/checkout@v4` uses a mutable tag. Pin to a SHA.

**Fix at line 13:**

Change:
```yaml
- uses: actions/checkout@v4
```
To:
```yaml
- uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683 # v4.2.2
```

No tests needed — this is CI config only.

---

### Task 4: MCP Server Security (Findings #6, #7)

**Files:** `packages/server/src/mcp/server.ts`
**Severity:** MEDIUM

Two fixes in the MCP server, both in the same file.

#### 4a. Remove cross-user audit trail reads (Finding #6)

At `mcp/server.ts:557-564`, the `rome_audit_trail` tool accepts a `user_id` parameter that lets any MCP user read another user's audit entries.

**Fix:**

1. Remove the `user_id` field from the tool's Zod schema (line 557).
2. In the handler at line 564, always use the caller's `userId` instead of `args.user_id`:
   ```typescript
   const scopedArgs = { ...args, user_id: userId };
   ```
   (Remove the `args.user_id ??` fallback.)

#### 4b. Remove legacy MCP_AUTH_TOKEN bypass (Finding #7)

At `mcp/server.ts:607-611`, the auth handler accepts a static `MCP_AUTH_TOKEN` env var as a bypass. This token never expires and falls back to `mcp-service-user-00000000`.

**Fix:**

1. Remove the static token check entirely (lines 608-611). The auth handler should only accept JWTs:
   ```typescript
   const token = authHeader.slice(7);
   let tokenValid = false;
   let tokenUserId = MCP_SERVICE_USER_ID;
   try {
     const payload = jwt.verify(token, getJwtSecret()) as AuthPayload;
     tokenValid = true;
     tokenUserId = payload.userId;
   } catch {
     // JWT verification failed
   }
   ```

2. Also extract `userId` from the JWT payload so the MCP server instance gets the real user's ID (not the service account). Currently `createMcpServer` is called with a `userId` that comes from... let me check. Actually, looking at the handler flow more carefully: the `createMcpHandler` returns a request handler. Each request needs to extract `userId` from the JWT and pass it to `createMcpServer`. This may already happen for JWT-authenticated requests but falls back to `MCP_SERVICE_USER_ID` for static token requests. After removing static token support, the userId extraction from JWT should be the only path.

3. Update the auth handler to extract `userId` from the verified JWT payload and use it when creating the MCP server session. If the JWT doesn't contain a `userId`, reject with 401.

4. Update the comment at the top of the file (line 8) to remove the reference to `MCP_AUTH_TOKEN`.

#### Tests for Task 4

Add tests in `packages/server/src/test/mcp.test.ts` (if not already covered):
- Verify `rome_audit_trail` does NOT accept a `user_id` parameter (or ignores it)
- Verify MCP rejects a static token (non-JWT Bearer value) with 401

---

### Task 5: Remove ensureUser Auto-Provisioning (Finding #8)

**Files:** `packages/server/src/routes/nodes.ts`
**Severity:** MEDIUM

`ensureUser()` at `nodes.ts:9-22` auto-creates user rows with empty `passwordHash` when a JWT references a non-existent userId.

**Fix:**

1. Remove the `ensureUser` function entirely (lines 8-23).
2. Remove the `ensureUser(db, req.auth!.userId)` call at line 113 (inside the POST handler).
3. Remove the `users` import from line 4 if it becomes unused (check — it may be needed by other code in this file). If only `ensureUser` uses `users`, remove it.

**Key constraint:** The only caller is `POST /api/nodes` (line 113). Removing it means if a JWT somehow references a non-existent user, the node is created but has no user row. Since all users are created through `/api/auth/register` or `seed-admin.ts`, this should never happen in normal operation. The MCP service user is created by `seed-admin.ts` on startup (idempotent).

#### Tests for Task 5

- Verify no existing tests rely on `ensureUser` behavior. Search for `ensureUser` in test files.
- Existing `POST /api/nodes` tests should still pass since they use properly registered users.

---

## Verification

After all tasks complete, run the full test suite:

```bash
npm run build --workspace=packages/shared
npm run typecheck --workspace=packages/server
npm run typecheck --workspace=packages/client
npm run test --workspace=packages/server
```

All 106+ tests must pass. New OAuth tests bring the count higher.

## Definition of Done

- [ ] Task 1: OAuth authorize requires login, client_id required, redirect_uri always validated, register rate-limited and capped
- [ ] Task 2: Dockerfile runs as non-root `rome` user
- [ ] Task 3: actions/checkout pinned to SHA
- [ ] Task 4: rome_audit_trail locked to caller's userId, MCP_AUTH_TOKEN removed
- [ ] Task 5: ensureUser auto-provisioning removed
- [ ] All server tests pass (existing + new OAuth tests)
- [ ] Server and client typecheck clean
