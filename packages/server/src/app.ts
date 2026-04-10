import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import express from "express";
import type BetterSqlite3 from "better-sqlite3";
import type { Db } from "./db.js";
import { authRoutes } from "./routes/auth.js";
import { nodeRoutes } from "./routes/nodes.js";
import { edgeRoutes } from "./routes/edges.js";
import { graphRoutes, budgetRoutes } from "./routes/graph.js";
import { taskRoutes } from "./routes/tasks.js";
import { archiveRoutes } from "./routes/archive.js";
import { authMiddleware } from "./middleware/auth.js";
import { getJwtSecret } from "./middleware/auth.js";
import { createMcpHandler } from "./mcp/server.js";
import jwt from "jsonwebtoken";
import bcrypt from "bcrypt";
import { eq } from "drizzle-orm";
import { users, oauthClients, oauthTokens } from "@rome/shared/schema";
import rateLimit from "express-rate-limit";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function createApp(db: Db, sqlite?: BetterSqlite3.Database) {
  const app = express();

  app.use(express.json());

  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  app.use("/api/auth", authRoutes(db));
  app.use("/api/nodes", authMiddleware, nodeRoutes(db));
  app.use("/api/edges", authMiddleware, edgeRoutes(db));
  app.use("/api/graph", authMiddleware, graphRoutes(db));
  app.use("/api/budget", authMiddleware, budgetRoutes(db));
  app.use("/api/tasks", authMiddleware, taskRoutes(db));
  app.use("/api/archive", authMiddleware, archiveRoutes(db));

  // --- MCP OAuth 2.0 endpoints (for Claude Co-Work custom connectors) ---
  // Follows MCP spec: RFC9728 Protected Resource Metadata → OAuth Authorization Server Metadata

  // Helper: get base URL respecting Railway's TLS proxy
  function baseUrl(req: express.Request): string {
    const proto = req.get("x-forwarded-proto") || req.protocol;
    return `${proto}://${req.get("host")}`;
  }

  // Step 1: Protected Resource Metadata (RFC9728)
  // Claude discovers this first, pointed to by WWW-Authenticate header on 401
  app.get("/.well-known/oauth-protected-resource", (_req, res) => {
    const base = baseUrl(_req);
    res.json({
      resource: `${base}/mcp`,
      authorization_servers: [base],
      scopes_supported: ["mcp:tools"],
    });
  });

  // Step 2: OAuth Authorization Server Metadata
  app.get("/.well-known/oauth-authorization-server", (_req, res) => {
    const base = baseUrl(_req);
    res.json({
      issuer: base,
      authorization_endpoint: `${base}/oauth/authorize`,
      token_endpoint: `${base}/oauth/token`,
      registration_endpoint: `${base}/oauth/register`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code"],
      code_challenge_methods_supported: ["S256"],
    });
  });

  // Helper: validate client_id and redirect_uri, returns error string or null
  function validateClientAndRedirectUri(
    clientId: string | undefined,
    redirectUri: string | undefined,
    res: express.Response,
  ): boolean {
    if (!clientId) {
      res.status(400).json({ error: "client_id required" });
      return false;
    }
    if (!redirectUri) {
      res.status(400).json({ error: "redirect_uri required" });
      return false;
    }
    const client = db.select().from(oauthClients).where(eq(oauthClients.clientId, clientId)).get();
    if (!client) {
      res.status(400).json({ error: "Unknown client_id" });
      return false;
    }
    const uris: string[] = JSON.parse(client.redirectUris || "[]");
    if (uris.length > 0 && !uris.includes(redirectUri)) {
      res.status(400).json({ error: "Invalid redirect_uri" });
      return false;
    }
    return true;
  }

  // Escape HTML to prevent XSS in error messages
  function escapeHtml(str: string): string {
    return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  // HTML login form for OAuth authorization
  function renderAuthorizeForm(params: {
    client_id: string;
    redirect_uri: string;
    state?: string;
    code_challenge?: string;
    code_challenge_method?: string;
    error?: string;
  }): string {
    const errorHtml = params.error
      ? `<div style="background:#fee;border:1px solid #c00;border-radius:6px;padding:10px 14px;margin-bottom:16px;color:#c00;font-size:14px;">${escapeHtml(params.error)}</div>`
      : "";
    const hidden = (name: string, value: string | undefined) =>
      value ? `<input type="hidden" name="${name}" value="${encodeURIComponent(value)}">` : "";
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Authorize MCP Access</title>
  <style>
    body { margin: 0; font-family: 'Montserrat', sans-serif; background: #F5F4F2; display: flex; align-items: center; justify-content: center; min-height: 100vh; }
    .card { background: #fff; border-radius: 8px; border: 1px solid #E5E3DF; padding: 40px 36px; width: 100%; max-width: 400px; box-shadow: 0 2px 12px rgba(0,0,0,0.07); }
    h1 { margin: 0 0 8px; font-size: 22px; color: #1A1A1A; font-weight: 700; }
    p { margin: 0 0 24px; font-size: 14px; color: #6B6968; }
    label { display: block; font-size: 13px; font-weight: 600; color: #1A1A1A; margin-bottom: 6px; }
    input[type=text], input[type=password] { width: 100%; box-sizing: border-box; padding: 10px 12px; border: 1px solid #E5E3DF; border-radius: 6px; font-size: 14px; color: #1A1A1A; margin-bottom: 16px; outline: none; }
    input[type=text]:focus, input[type=password]:focus { border-color: #B81917; }
    button { width: 100%; padding: 11px; background: #B81917; color: #fff; border: none; border-radius: 6px; font-size: 15px; font-weight: 700; cursor: pointer; margin-top: 4px; }
    button:hover { background: #9a1614; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Authorize MCP Access</h1>
    <p>Sign in to grant Claude access to Rome.</p>
    ${errorHtml}
    <form method="POST" action="/oauth/authorize">
      ${hidden("client_id", params.client_id)}
      ${hidden("redirect_uri", params.redirect_uri)}
      ${hidden("state", params.state)}
      ${hidden("code_challenge", params.code_challenge)}
      ${hidden("code_challenge_method", params.code_challenge_method)}
      <label for="username">Username</label>
      <input type="text" id="username" name="username" autocomplete="username" required>
      <label for="password">Password</label>
      <input type="password" id="password" name="password" autocomplete="current-password" required>
      <button type="submit">Approve</button>
    </form>
  </div>
</body>
</html>`;
  }

  // Authorization endpoint — shows login form, validates credentials
  app.get("/oauth/authorize", (req, res) => {
    const { redirect_uri, state, code_challenge, code_challenge_method, client_id } = req.query;

    if (!validateClientAndRedirectUri(client_id as string | undefined, redirect_uri as string | undefined, res)) {
      return;
    }

    // Require PKCE S256 — public clients have no client_secret, so code_challenge is the
    // sole proof-of-possession. Without it an intercepted auth code can be exchanged freely.
    if (!code_challenge || code_challenge_method !== "S256") {
      res.status(400).json({ error: "code_challenge with code_challenge_method S256 is required" });
      return;
    }

    res.setHeader("Content-Type", "text/html");
    res.send(
      renderAuthorizeForm({
        client_id: client_id as string,
        redirect_uri: redirect_uri as string,
        state: state as string | undefined,
        code_challenge: code_challenge as string | undefined,
        code_challenge_method: code_challenge_method as string | undefined,
      }),
    );
  });

  app.post("/oauth/authorize", express.urlencoded({ extended: false }), async (req, res) => {
    // Decode hidden fields (form encodes them with encodeURIComponent)
    const decode = (v: string | undefined) => (v ? decodeURIComponent(v) : undefined);
    const client_id = decode(req.body.client_id);
    const redirect_uri = decode(req.body.redirect_uri);
    const state = decode(req.body.state);
    const code_challenge = decode(req.body.code_challenge);
    const code_challenge_method = decode(req.body.code_challenge_method);
    const { username, password } = req.body;

    if (!validateClientAndRedirectUri(client_id, redirect_uri, res)) {
      return;
    }

    // Require PKCE S256 on POST too — same check as the GET handler.
    // A direct POST bypassing the form could omit code_challenge otherwise.
    if (!code_challenge || code_challenge_method !== "S256") {
      res.status(400).json({ error: "code_challenge with code_challenge_method S256 is required" });
      return;
    }

    const renderError = (msg: string) => {
      res.setHeader("Content-Type", "text/html");
      res.send(
        renderAuthorizeForm({
          client_id: client_id!,
          redirect_uri: redirect_uri!,
          state,
          code_challenge,
          code_challenge_method,
          error: msg,
        }),
      );
    };

    if (!username || !password) {
      renderError("Username and password are required.");
      return;
    }

    const user = db.select().from(users).where(eq(users.username, username)).get();
    if (!user) {
      renderError("Invalid username or password.");
      return;
    }

    const passwordOk = await bcrypt.compare(password, user.passwordHash);
    if (!passwordOk) {
      renderError("Invalid username or password.");
      return;
    }

    // Credentials valid — issue code
    const code = Buffer.from(crypto.randomUUID()).toString("base64url");
    const codeStore = (app as any)._oauthCodes ?? new Map();
    codeStore.set(code, {
      redirect_uri,
      code_challenge,
      code_challenge_method,
      userId: user.id,
      expires: Date.now() + 5 * 60 * 1000,
    });
    (app as any)._oauthCodes = codeStore;

    const url = new URL(redirect_uri!);
    url.searchParams.set("code", code);
    if (state) url.searchParams.set("state", state);

    res.redirect(url.toString());
  });

  // Rate limiter for /oauth/register — 5 registrations per 15 minutes per IP
  const oauthRegisterLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: process.env["SKIP_RATE_LIMIT"] === "true" ? 10000 : 5,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many registration requests, please try again later." },
    skip: () => process.env["SKIP_RATE_LIMIT"] === "true",
  });

  // Dynamic Client Registration (RFC7591) — Claude registers itself as a client
  app.post("/oauth/register", oauthRegisterLimiter, (req, res) => {
    const totalClients = (db.select().from(oauthClients).all()).length;
    if (totalClients >= 50) {
      res.status(429).json({ error: "Client registration limit reached" });
      return;
    }

    const { client_name, redirect_uris } = req.body;
    const clientId = `rome-client-${crypto.randomUUID().slice(0, 8)}`;
    const now = new Date().toISOString();
    db.insert(oauthClients).values({
      clientId,
      clientName: client_name || "Claude",
      redirectUris: JSON.stringify(redirect_uris || []),
      createdAt: now,
    }).run();

    res.status(201).json({
      client_id: clientId,
      client_name: client_name || "Claude",
      redirect_uris: redirect_uris || [],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    });
  });

  // Token endpoint — exchanges code or refresh_token for access token
  app.post("/oauth/token", express.urlencoded({ extended: false }), (req, res) => {
    const { grant_type, code, code_verifier, refresh_token } = req.body;
    const jwtSecret = getJwtSecret();

    // --- Refresh token grant ---
    if (grant_type === "refresh_token") {
      if (!refresh_token) {
        res.status(400).json({ error: "refresh_token required" });
        return;
      }
      const stored = db.select().from(oauthTokens).where(eq(oauthTokens.refreshToken, refresh_token)).get();
      if (!stored) {
        res.status(400).json({ error: "invalid_grant", error_description: "Unknown or expired refresh token" });
        return;
      }
      if (new Date(stored.expiresAt) < new Date()) {
        db.delete(oauthTokens).where(eq(oauthTokens.refreshToken, refresh_token)).run();
        res.status(400).json({ error: "invalid_grant", error_description: "Refresh token expired" });
        return;
      }

      // Issue new access token (refresh token stays valid until its own expiry)
      const accessToken = jwt.sign(
        { userId: stored.userId, scope: "mcp:tools", type: "mcp_access" },
        jwtSecret,
        { expiresIn: "7d" },
      );
      res.json({
        access_token: accessToken,
        token_type: "Bearer",
        expires_in: 7 * 24 * 3600,
        refresh_token,
      });
      return;
    }

    // --- Authorization code grant ---
    if (grant_type !== "authorization_code") {
      res.status(400).json({ error: "unsupported_grant_type" });
      return;
    }

    const codeStore: Map<string, any> = (app as any)._oauthCodes ?? new Map();
    const stored = codeStore.get(code);
    if (!stored || stored.expires < Date.now()) {
      codeStore.delete(code);
      res.status(400).json({ error: "invalid_grant" });
      return;
    }
    codeStore.delete(code);

    // Validate PKCE code_verifier if code_challenge was provided
    if (stored.code_challenge && stored.code_challenge_method === "S256") {
      const expected = crypto.createHash("sha256").update(code_verifier || "").digest("base64url");
      if (expected !== stored.code_challenge) {
        res.status(400).json({ error: "invalid_grant", error_description: "PKCE verification failed" });
        return;
      }
    }

    if (!stored.userId) {
      res.status(400).json({ error: "invalid_grant", error_description: "Auth code missing userId — this should not happen" });
      return;
    }
    const tokenUserId = stored.userId;

    // Generate access token (7 days)
    const accessToken = jwt.sign(
      { userId: tokenUserId, scope: "mcp:tools", type: "mcp_access" },
      jwtSecret,
      { expiresIn: "7d" },
    );

    // Generate refresh token (30 days), persisted to SQLite
    const newRefreshToken = Buffer.from(crypto.randomUUID()).toString("base64url");
    const refreshExpiry = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    const now = new Date().toISOString();
    db.insert(oauthTokens).values({
      id: crypto.randomUUID(),
      userId: tokenUserId,
      refreshToken: newRefreshToken,
      expiresAt: refreshExpiry,
      createdAt: now,
    }).run();

    res.json({
      access_token: accessToken,
      token_type: "Bearer",
      expires_in: 7 * 24 * 3600,
      refresh_token: newRefreshToken,
    });
  });

  // MCP endpoint — mounted BEFORE static middleware so /mcp isn't caught by SPA catch-all
  const mcpHandler = sqlite ? createMcpHandler(db, sqlite) : undefined;
  if (mcpHandler) {
    app.all(["/mcp", "/mcp/*"], (req, res, next) => {
      Promise.resolve(mcpHandler(req, res, next)).catch((err) => {
        console.error("[MCP] Unhandled error:", err);
        if (!res.headersSent) {
          res.status(500).json({ error: "MCP handler error" });
        }
      });
    });
  }

  // Serve static client assets in production
  const clientDist = process.env["CLIENT_DIST"] || path.resolve(__dirname, "../../client/dist");
  app.use(express.static(clientDist));
  app.get("*", (_req, res, next) => {
    if (_req.path.startsWith("/api") || _req.path.startsWith("/ws") || _req.path === "/health" || _req.path.startsWith("/mcp")) {
      return next();
    }
    res.sendFile(path.join(clientDist, "index.html"));
  });

  return app;
}
