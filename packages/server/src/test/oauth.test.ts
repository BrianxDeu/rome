import { describe, it, expect, beforeEach, afterEach } from "vitest";
import request from "supertest";
import crypto from "node:crypto";
import { createTestContext, closeTestContext, createTestUser } from "./helpers.js";
import { createApp } from "../app.js";

// Allow unlimited registrations in tests (bypasses rate limiter middleware)
process.env["SKIP_RATE_LIMIT"] = "true";

let ctx: ReturnType<typeof createTestContext>;

beforeEach(() => {
  ctx = createTestContext();
});

afterEach(() => {
  closeTestContext(ctx);
});

// Helper: register a client and return its client_id
async function registerClient(app: any, redirectUri = "https://claude.ai/callback"): Promise<string> {
  const res = await request(app)
    .post("/oauth/register")
    .send({ client_name: "Test Client", redirect_uris: [redirectUri] });
  expect(res.status).toBe(201);
  return res.body.client_id;
}

// Helper: build a PKCE challenge/verifier pair
function makePkce(): { verifier: string; challenge: string } {
  const verifier = Buffer.from(crypto.randomBytes(32)).toString("base64url");
  const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

describe("GET /oauth/authorize", () => {
  it("returns 400 when client_id is missing", async () => {
    const res = await request(ctx.app)
      .get("/oauth/authorize")
      .query({ redirect_uri: "https://claude.ai/callback" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/client_id/i);
  });

  it("returns 400 for unknown client_id", async () => {
    const res = await request(ctx.app)
      .get("/oauth/authorize")
      .query({ client_id: "nonexistent", redirect_uri: "https://claude.ai/callback" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/unknown client_id/i);
  });

  it("returns 400 for invalid redirect_uri", async () => {
    const clientId = await registerClient(ctx.app, "https://claude.ai/callback");
    const res = await request(ctx.app)
      .get("/oauth/authorize")
      .query({ client_id: clientId, redirect_uri: "https://evil.example.com/steal" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/redirect_uri/i);
  });

  it("returns 400 when code_challenge is missing (PKCE required)", async () => {
    const clientId = await registerClient(ctx.app);
    const res = await request(ctx.app)
      .get("/oauth/authorize")
      .query({ client_id: clientId, redirect_uri: "https://claude.ai/callback" });
    // No code_challenge — must be rejected (public clients have no client_secret)
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/code_challenge/i);
  });

  it("returns HTML login form with valid params", async () => {
    const clientId = await registerClient(ctx.app);
    const { challenge } = makePkce();
    const res = await request(ctx.app)
      .get("/oauth/authorize")
      .query({ client_id: clientId, redirect_uri: "https://claude.ai/callback", state: "xyz", code_challenge: challenge, code_challenge_method: "S256" });
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/html/);
    expect(res.text).toContain("<form");
    expect(res.text).toContain("Authorize MCP Access");
  });
});

describe("POST /oauth/authorize", () => {
  it("redirects with code when credentials are valid", async () => {
    const user = await createTestUser(ctx.db, { username: "alice", password: "password123" });
    const clientId = await registerClient(ctx.app);
    const { verifier, challenge } = makePkce();

    const res = await request(ctx.app)
      .post("/oauth/authorize")
      .type("form")
      .send({
        client_id: encodeURIComponent(clientId),
        redirect_uri: encodeURIComponent("https://claude.ai/callback"),
        state: encodeURIComponent("abc"),
        code_challenge: encodeURIComponent(challenge),
        code_challenge_method: encodeURIComponent("S256"),
        username: user.username,
        password: "password123",
      });

    expect(res.status).toBe(302);
    const location = res.headers["location"] as string;
    expect(location).toBeDefined();
    const url = new URL(location);
    expect(url.searchParams.get("code")).toBeTruthy();
    expect(url.searchParams.get("state")).toBe("abc");
  });

  it("returns form with error when password is wrong", async () => {
    await createTestUser(ctx.db, { username: "alice", password: "password123" });
    const clientId = await registerClient(ctx.app);

    const res = await request(ctx.app)
      .post("/oauth/authorize")
      .type("form")
      .send({
        client_id: encodeURIComponent(clientId),
        redirect_uri: encodeURIComponent("https://claude.ai/callback"),
        username: "alice",
        password: "wrongpassword",
      });

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/html/);
    expect(res.text).toContain("<form");
    expect(res.text.toLowerCase()).toMatch(/invalid|error/);
  });

  it("returns form with error when user does not exist", async () => {
    const clientId = await registerClient(ctx.app);

    const res = await request(ctx.app)
      .post("/oauth/authorize")
      .type("form")
      .send({
        client_id: encodeURIComponent(clientId),
        redirect_uri: encodeURIComponent("https://claude.ai/callback"),
        username: "nobody",
        password: "password123",
      });

    expect(res.status).toBe(200);
    expect(res.text).toContain("<form");
    expect(res.text.toLowerCase()).toMatch(/invalid|error/);
  });
});

describe("POST /oauth/token — authenticated flow", () => {
  it("returns JWT with real userId (not mcp-service-user-00000000)", async () => {
    const user = await createTestUser(ctx.db, { username: "bob", password: "secret99" });
    const clientId = await registerClient(ctx.app);
    const { verifier, challenge } = makePkce();

    // Step 1: get authorization code via POST (authenticated)
    const authorizeRes = await request(ctx.app)
      .post("/oauth/authorize")
      .type("form")
      .send({
        client_id: encodeURIComponent(clientId),
        redirect_uri: encodeURIComponent("https://claude.ai/callback"),
        code_challenge: encodeURIComponent(challenge),
        code_challenge_method: encodeURIComponent("S256"),
        username: user.username,
        password: "secret99",
      });

    expect(authorizeRes.status).toBe(302);
    const location = authorizeRes.headers["location"] as string;
    const code = new URL(location).searchParams.get("code")!;
    expect(code).toBeTruthy();

    // Step 2: exchange code for token
    const tokenRes = await request(ctx.app)
      .post("/oauth/token")
      .type("form")
      .send({
        grant_type: "authorization_code",
        code,
        client_id: clientId,
        code_verifier: verifier,
      });

    expect(tokenRes.status).toBe(200);
    expect(tokenRes.body.access_token).toBeDefined();
    expect(tokenRes.body.token_type).toBe("Bearer");

    // Decode JWT payload (no verification needed — just checking the claim)
    const payload = JSON.parse(Buffer.from(tokenRes.body.access_token.split(".")[1], "base64url").toString());
    expect(payload.userId).toBe(user.id);
    expect(payload.userId).not.toBe("mcp-service-user-00000000");
  });
});

describe("POST /oauth/token — refresh_token grant", () => {
  it("issues a refresh_token on authorization_code exchange and accepts it for new access token", async () => {
    const user = await createTestUser(ctx.db, { username: "charlie", password: "pass1234" });
    const clientId = await registerClient(ctx.app);
    const { verifier, challenge } = makePkce();

    // Get auth code
    const authRes = await request(ctx.app)
      .post("/oauth/authorize")
      .type("form")
      .send({
        client_id: encodeURIComponent(clientId),
        redirect_uri: encodeURIComponent("https://claude.ai/callback"),
        code_challenge: encodeURIComponent(challenge),
        code_challenge_method: encodeURIComponent("S256"),
        username: user.username,
        password: "pass1234",
      });
    const code = new URL(authRes.headers["location"] as string).searchParams.get("code")!;

    // Exchange code — should receive refresh_token
    const tokenRes = await request(ctx.app)
      .post("/oauth/token")
      .type("form")
      .send({ grant_type: "authorization_code", code, code_verifier: verifier });
    expect(tokenRes.status).toBe(200);
    expect(tokenRes.body.refresh_token).toBeTruthy();
    expect(tokenRes.body.expires_in).toBe(7 * 24 * 3600);

    const refreshToken = tokenRes.body.refresh_token;

    // Use refresh_token to get a new access token
    const refreshRes = await request(ctx.app)
      .post("/oauth/token")
      .type("form")
      .send({ grant_type: "refresh_token", refresh_token: refreshToken });
    expect(refreshRes.status).toBe(200);
    expect(refreshRes.body.access_token).toBeTruthy();
    expect(refreshRes.body.refresh_token).toBe(refreshToken);

    const payload = JSON.parse(Buffer.from(refreshRes.body.access_token.split(".")[1], "base64url").toString());
    expect(payload.userId).toBe(user.id);
  });

  it("returns 400 for unknown refresh_token", async () => {
    const res = await request(ctx.app)
      .post("/oauth/token")
      .type("form")
      .send({ grant_type: "refresh_token", refresh_token: "bogus-token" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_grant");
  });

  it("persists registered client across a new app instance using the same SQLite DB", async () => {
    // Register in first app instance (with PKCE)
    const clientId = await registerClient(ctx.app);
    const { challenge } = makePkce();

    // Create a second app instance pointing to the same SQLite DB
    const app2 = createApp(ctx.db, ctx.sqlite);

    // The registered client should be recognized by the new instance
    const res = await request(app2)
      .get("/oauth/authorize")
      .query({ client_id: clientId, redirect_uri: "https://claude.ai/callback", code_challenge: challenge, code_challenge_method: "S256" });
    // Should return the login form (200), not 400 unknown client
    expect(res.status).toBe(200);
    expect(res.text).toContain("<form");
  });
});

describe("POST /oauth/register", () => {
  it("registers a new client successfully", async () => {
    const res = await request(ctx.app)
      .post("/oauth/register")
      .send({ client_name: "My Client", redirect_uris: ["https://example.com/cb"] });
    expect(res.status).toBe(201);
    expect(res.body.client_id).toBeDefined();
    expect(res.body.redirect_uris).toEqual(["https://example.com/cb"]);
  });

  it("returns 429 when 51st registration hits the cap", async () => {
    // Register 50 clients first
    for (let i = 0; i < 50; i++) {
      const res = await request(ctx.app)
        .post("/oauth/register")
        .send({ client_name: `Client ${i}`, redirect_uris: [`https://example.com/cb/${i}`] });
      expect(res.status).toBe(201);
    }

    // 51st should be rejected due to cap (not rate limit — SKIP_RATE_LIMIT=true)
    const res = await request(ctx.app)
      .post("/oauth/register")
      .send({ client_name: "Over the limit", redirect_uris: ["https://example.com/cb/51"] });
    expect(res.status).toBe(429);
    expect(res.body.error).toMatch(/limit/i);
  });
});
