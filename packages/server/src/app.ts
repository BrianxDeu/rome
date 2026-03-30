import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import express from "express";
import type { Db } from "./db.js";
import { authRoutes } from "./routes/auth.js";
import { nodeRoutes } from "./routes/nodes.js";
import { edgeRoutes } from "./routes/edges.js";
import { graphRoutes, budgetRoutes } from "./routes/graph.js";
import { taskRoutes } from "./routes/tasks.js";
import { authMiddleware } from "./middleware/auth.js";
import { createMcpHandler } from "./mcp/server.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function createApp(db: Db) {
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

  // Authorization endpoint — auto-approves and redirects back with a code
  app.get("/oauth/authorize", (req, res) => {
    const { redirect_uri, state, code_challenge, code_challenge_method } = req.query;
    if (!redirect_uri) {
      res.status(400).json({ error: "redirect_uri required" });
      return;
    }
    // Generate a one-time code (just use a random string — we validate client_secret at token exchange)
    const code = Buffer.from(crypto.randomUUID()).toString("base64url");
    // Store code temporarily (in-memory, expires in 5 min)
    const codeStore = (app as any)._oauthCodes ?? new Map();
    codeStore.set(code, {
      redirect_uri,
      code_challenge,
      code_challenge_method,
      expires: Date.now() + 5 * 60 * 1000,
    });
    (app as any)._oauthCodes = codeStore;

    const url = new URL(redirect_uri as string);
    url.searchParams.set("code", code);
    if (state) url.searchParams.set("state", state as string);

    // Redirect back to Claude's callback — do NOT auto-close the tab,
    // as that kills the in-flight token exchange
    res.redirect(url.toString());
  });

  // Dynamic Client Registration (RFC7591) — Claude registers itself as a client
  app.post("/oauth/register", (req, res) => {
    const { client_name, redirect_uris } = req.body;
    const clientId = `rome-client-${crypto.randomUUID().slice(0, 8)}`;
    // Store registered client (in-memory for simplicity)
    const clientStore: Map<string, any> = (app as any)._oauthClients ?? new Map();
    clientStore.set(clientId, { client_name, redirect_uris });
    (app as any)._oauthClients = clientStore;

    res.status(201).json({
      client_id: clientId,
      client_name: client_name || "Claude",
      redirect_uris: redirect_uris || [],
      grant_types: ["authorization_code"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    });
  });

  // Token endpoint — exchanges code for access token
  app.post("/oauth/token", express.urlencoded({ extended: false }), (req, res) => {
    const { grant_type, code, client_id, client_secret, code_verifier } = req.body;

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

    // The access token IS the MCP_AUTH_TOKEN — Claude will send it as Bearer on MCP requests
    const authToken = process.env.MCP_AUTH_TOKEN;
    if (!authToken) {
      res.status(500).json({ error: "server_error", error_description: "MCP_AUTH_TOKEN not configured" });
      return;
    }

    res.json({
      access_token: authToken,
      token_type: "Bearer",
      expires_in: 604800,
    });
  });

  // MCP endpoint — mounted BEFORE static middleware so /mcp isn't caught by SPA catch-all
  const mcpHandler = createMcpHandler(db);
  app.all(["/mcp", "/mcp/*"], (req, res, next) => {
    Promise.resolve(mcpHandler(req, res, next)).catch((err) => {
      console.error("[MCP] Unhandled error:", err);
      if (!res.headersSent) {
        res.status(500).json({ error: "MCP handler error" });
      }
    });
  });

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
