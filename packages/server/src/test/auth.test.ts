import { describe, it, expect, beforeEach, afterEach } from "vitest";
import request from "supertest";
import { createTestContext, closeTestContext } from "./helpers.js";

let ctx: ReturnType<typeof createTestContext>;

beforeEach(() => {
  ctx = createTestContext();
});

afterEach(() => {
  closeTestContext(ctx);
});

describe("POST /api/auth/register", () => {
  it("registers the first user as admin", async () => {
    const res = await request(ctx.app)
      .post("/api/auth/register")
      .send({ username: "alice", email: "alice@test.com", password: "password123" });

    expect(res.status).toBe(201);
    expect(res.body.token).toBeDefined();
    expect(res.body.user.username).toBe("alice");
    expect(res.body.user.role).toBe("admin");
    expect(res.body.user.passwordHash).toBeUndefined();
  });

  it("registers the second user as member", async () => {
    await request(ctx.app)
      .post("/api/auth/register")
      .send({ username: "alice", email: "alice@test.com", password: "password123" });

    const res = await request(ctx.app)
      .post("/api/auth/register")
      .send({ username: "bob", email: "bob@test.com", password: "password123" });

    expect(res.status).toBe(201);
    expect(res.body.user.role).toBe("member");
  });

  it("rejects duplicate username", async () => {
    await request(ctx.app)
      .post("/api/auth/register")
      .send({ username: "alice", email: "alice@test.com", password: "password123" });

    const res = await request(ctx.app)
      .post("/api/auth/register")
      .send({ username: "alice", email: "alice2@test.com", password: "password123" });

    expect(res.status).toBe(409);
  });

  it("rejects duplicate email", async () => {
    await request(ctx.app)
      .post("/api/auth/register")
      .send({ username: "alice", email: "alice@test.com", password: "password123" });

    const res = await request(ctx.app)
      .post("/api/auth/register")
      .send({ username: "bob", email: "alice@test.com", password: "password123" });

    expect(res.status).toBe(409);
  });

  it("rejects short password", async () => {
    const res = await request(ctx.app)
      .post("/api/auth/register")
      .send({ username: "alice", email: "alice@test.com", password: "short" });

    expect(res.status).toBe(400);
  });

  it("rejects missing fields", async () => {
    const res = await request(ctx.app)
      .post("/api/auth/register")
      .send({ username: "alice" });

    expect(res.status).toBe(400);
  });
});

describe("POST /api/auth/login", () => {
  beforeEach(async () => {
    await request(ctx.app)
      .post("/api/auth/register")
      .send({ username: "alice", email: "alice@test.com", password: "password123" });
  });

  it("logs in with valid credentials", async () => {
    const res = await request(ctx.app)
      .post("/api/auth/login")
      .send({ username: "alice", password: "password123" });

    expect(res.status).toBe(200);
    expect(res.body.token).toBeDefined();
    expect(res.body.user.username).toBe("alice");
    expect(res.body.user.passwordHash).toBeUndefined();
  });

  it("rejects invalid password", async () => {
    const res = await request(ctx.app)
      .post("/api/auth/login")
      .send({ username: "alice", password: "wrongpassword" });

    expect(res.status).toBe(401);
  });

  it("rejects unknown username", async () => {
    const res = await request(ctx.app)
      .post("/api/auth/login")
      .send({ username: "nobody", password: "password123" });

    expect(res.status).toBe(401);
  });
});

describe("JWT middleware", () => {
  it("health endpoint works without auth", async () => {
    const res = await request(ctx.app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
  });
});
