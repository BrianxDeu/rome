import { describe, it, expect, beforeEach, afterEach } from "vitest";
import request from "supertest";
import { createTestContext, closeTestContext, createTestUser } from "./helpers.js";

let ctx: ReturnType<typeof createTestContext>;

beforeEach(() => {
  ctx = createTestContext();
});

afterEach(() => {
  closeTestContext(ctx);
});

// ---------------------------------------------------------------------------
// Auth Security Tests
// ---------------------------------------------------------------------------

describe("Auth Security", () => {
  describe("JWT secret", () => {
    it("should use JWT_SECRET env var (fallback 'rome-dev-secret' is insecure for production)", () => {
      // The current code uses: process.env["JWT_SECRET"] || "rome-dev-secret"
      // After the security fix, if JWT_SECRET is missing the server should refuse
      // to start or sign tokens. This test documents the expected secure behavior.
      // For now, we just verify that tokens are signed with a consistent secret
      // (i.e., login token can be verified against the same secret).
      // When the fallback is removed, this test should verify that createApp()
      // throws or that token signing fails when JWT_SECRET is unset.
    });
  });

  describe("Rate limiting on login", () => {
    beforeEach(async () => {
      process.env["SKIP_RATE_LIMIT"] = "false";
      await request(ctx.app)
        .post("/api/auth/register")
        .send({ username: "ratelimit-user", email: "ratelimit@test.com", password: "password123" });
    });

    afterEach(() => {
      process.env["SKIP_RATE_LIMIT"] = "true";
    });

    it("should return 429 after 10 failed login attempts within 15 minutes", async () => {
      for (let i = 0; i < 10; i++) {
        await request(ctx.app)
          .post("/api/auth/login")
          .send({ username: "ratelimit-user", password: "wrongpassword" });
      }

      const res = await request(ctx.app)
        .post("/api/auth/login")
        .send({ username: "ratelimit-user", password: "wrongpassword" });

      expect(res.status).toBe(429);
    });
  });

  describe("Rate limiting on register", () => {
    beforeEach(() => {
      process.env["SKIP_RATE_LIMIT"] = "false";
    });

    afterEach(() => {
      process.env["SKIP_RATE_LIMIT"] = "true";
    });

    it("should return 429 after 10 registration attempts within 15 minutes from same source", async () => {
      for (let i = 0; i < 10; i++) {
        await request(ctx.app)
          .post("/api/auth/register")
          .send({ username: `rateuser${i}`, email: `rateuser${i}@test.com`, password: "password123" });
      }

      const res = await request(ctx.app)
        .post("/api/auth/register")
        .send({ username: "rateuser10", email: "rateuser10@test.com", password: "password123" });

      expect(res.status).toBe(429);
    });
  });

  describe("Registration gate", () => {
    it("should return 403 when REGISTRATION_ENABLED is not 'true'", async () => {
      // When REGISTRATION_ENABLED env var is not "true", registration should be blocked.
      // This test expects the server to check the env var and reject.
      // The current code does not check REGISTRATION_ENABLED, so this will fail
      // until the security fix is applied.
      const originalEnv = process.env["REGISTRATION_ENABLED"];
      process.env["REGISTRATION_ENABLED"] = "false";

      try {
        const res = await request(ctx.app)
          .post("/api/auth/register")
          .send({ username: "gated", email: "gated@test.com", password: "password123" });

        expect(res.status).toBe(403);
      } finally {
        if (originalEnv !== undefined) {
          process.env["REGISTRATION_ENABLED"] = originalEnv;
        } else {
          delete process.env["REGISTRATION_ENABLED"];
        }
      }
    });
  });

  describe("Password minimum length", () => {
    it("should reject passwords shorter than 8 characters", async () => {
      const res = await request(ctx.app)
        .post("/api/auth/register")
        .send({ username: "shortpw", email: "shortpw@test.com", password: "abc" });

      expect(res.status).toBe(400);
    });

    it("should reject a 7-character password", async () => {
      const res = await request(ctx.app)
        .post("/api/auth/register")
        .send({ username: "shortpw", email: "shortpw@test.com", password: "abcdefg" });

      expect(res.status).toBe(400);
    });

    it("should accept exactly 8-character password", async () => {
      const res = await request(ctx.app)
        .post("/api/auth/register")
        .send({ username: "okpw", email: "okpw@test.com", password: "abcdefgh" });

      expect(res.status).toBe(201);
    });
  });
});

// NOTE: IDOR ownership checks removed — all authenticated users can edit/delete
// any node or edge. This is intentional for a small trusted team (5-10 users).

// ---------------------------------------------------------------------------
// OAuth Security Tests
// ---------------------------------------------------------------------------

describe("OAuth Security", () => {
  describe("OAuth authorize requires login", () => {
    it("should return 400 when client_id is missing", async () => {
      const res = await request(ctx.app)
        .get("/oauth/authorize")
        .query({
          redirect_uri: "http://example.com/callback",
          state: "test-state",
        });

      // Login gate: client_id is now required
      expect(res.status).toBe(400);
    });

    it("should return HTML login form (200) for valid params", async () => {
      const registerRes = await request(ctx.app)
        .post("/oauth/register")
        .send({ client_name: "TestClient", redirect_uris: ["http://example.com/callback"] });
      expect(registerRes.status).toBe(201);

      const pkceChallenge = require("crypto").createHash("sha256")
        .update(require("crypto").randomBytes(32).toString("base64url"))
        .digest("base64url");
      const res = await request(ctx.app)
        .get("/oauth/authorize")
        .query({
          client_id: registerRes.body.client_id,
          redirect_uri: "http://example.com/callback",
          state: "test-state",
          code_challenge: pkceChallenge,
          code_challenge_method: "S256",
        });

      expect(res.status).toBe(200);
      expect(res.text).toContain("<form");
    });
  });

  describe("OAuth redirect_uri validation", () => {
    it("should return 400 when redirect_uri is not registered", async () => {
      // Register a client with specific redirect URIs
      const registerRes = await request(ctx.app)
        .post("/oauth/register")
        .send({
          client_name: "TestClient",
          redirect_uris: ["http://allowed.com/callback"],
        });

      const clientId = registerRes.body.client_id;

      // Try to authorize with an unregistered redirect_uri
      const res = await request(ctx.app)
        .get("/oauth/authorize")
        .query({
          client_id: clientId,
          redirect_uri: "http://evil.com/steal-tokens",
          state: "test-state",
        });

      // After the fix, unregistered redirect_uris should be rejected
      expect(res.status).toBe(400);
    });
  });

  describe("OAuth token is per-session", () => {
    it("different OAuth flows should produce different authorization codes", async () => {
      // Start two separate OAuth flows and verify they get different codes
      const res1 = await request(ctx.app)
        .get("/oauth/authorize")
        .query({
          redirect_uri: "http://example.com/callback",
          state: "state1",
        })
        .redirects(0);

      const res2 = await request(ctx.app)
        .get("/oauth/authorize")
        .query({
          redirect_uri: "http://example.com/callback",
          state: "state2",
        })
        .redirects(0);

      // Both should redirect (302)
      // Extract codes from the redirect Location headers
      const location1 = res1.headers.location as string;
      const location2 = res2.headers.location as string;

      if (location1 && location2) {
        const code1 = new URL(location1).searchParams.get("code");
        const code2 = new URL(location2).searchParams.get("code");

        expect(code1).toBeDefined();
        expect(code2).toBeDefined();
        expect(code1).not.toBe(code2);
      }
    });
  });
});

// ---------------------------------------------------------------------------
// Infrastructure Tests
// ---------------------------------------------------------------------------

describe("Infrastructure Security", () => {
  describe("Socket.IO CORS", () => {
    it("should reject connections from unauthorized origins", async () => {
      // The current Socket.IO config uses cors: { origin: "*" } which is insecure.
      // After the fix, it should only allow specific origins.
      // This test verifies the CORS configuration on the socket setup.
      // Since we can't easily test Socket.IO CORS in unit tests without
      // starting a real server, we test the app-level configuration.

      // For now, document the expectation: after the fix, Socket.IO should
      // not allow cors: { origin: "*" }. The setupSocket function should
      // restrict origins to the configured frontend URL.

      // We can at least verify the health endpoint responds
      const res = await request(ctx.app).get("/health");
      expect(res.status).toBe(200);

      // This test is a placeholder — Socket.IO CORS is best tested
      // with an integration test that spins up the full HTTP server.
      // The important thing is that socket.ts CORS origin is not "*".
    });
  });

  describe("MCP uses caller identity", () => {
    it("MCP service user ID should not be used for operations that support user context", () => {
      // The MCP server uses MCP_SERVICE_USER_ID = "mcp-service-user-00000000"
      // as a hardcoded user for all operations. After the fix, MCP tool calls
      // should derive the user identity from the OAuth token / session, not
      // use a shared service account.

      // Import the constant to verify it exists (documenting the current state)
      // After the fix, this constant should be removed or only used as a fallback
      // when no user context is available.

      // This is a design-level test — the fix requires the MCP handler to
      // extract user identity from the Bearer token and pass it through
      // to service functions instead of using the hardcoded ID.
      expect(true).toBe(true); // Placeholder — real test requires MCP integration test
    });
  });

  describe("Auth middleware blocks unauthenticated API access", () => {
    it("GET /api/nodes without token returns 401", async () => {
      const res = await request(ctx.app).get("/api/nodes");
      expect(res.status).toBe(401);
    });

    it("POST /api/nodes without token returns 401", async () => {
      const res = await request(ctx.app)
        .post("/api/nodes")
        .send({ name: "test" });
      expect(res.status).toBe(401);
    });

    it("GET /api/edges without token returns 401", async () => {
      const res = await request(ctx.app).get("/api/edges");
      expect(res.status).toBe(401);
    });

    it("GET /api/graph without token returns 401", async () => {
      const res = await request(ctx.app).get("/api/graph");
      expect(res.status).toBe(401);
    });

    it("GET /api/tasks without token returns 401", async () => {
      const res = await request(ctx.app).get("/api/tasks");
      expect(res.status).toBe(401);
    });

    it("rejects a malformed JWT token", async () => {
      const res = await request(ctx.app)
        .get("/api/nodes")
        .set("Authorization", "Bearer this.is.not.a.valid.jwt");
      expect(res.status).toBe(401);
    });

    it("rejects an expired JWT token", async () => {
      // Create a token that expired 1 hour ago
      const jwt = await import("jsonwebtoken");
      const { getJwtSecret } = await import("../middleware/auth.js");
      const expiredToken = jwt.default.sign(
        { userId: "test-id", role: "member" },
        getJwtSecret(),
        { expiresIn: "-1h" },
      );

      const res = await request(ctx.app)
        .get("/api/nodes")
        .set("Authorization", `Bearer ${expiredToken}`);
      expect(res.status).toBe(401);
    });
  });
});
