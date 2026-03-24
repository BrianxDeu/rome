import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createServer } from "node:http";
import request from "supertest";
import { io as ioClient, type Socket as ClientSocket } from "socket.io-client";
import { createTestContext, closeTestContext, createTestUser } from "./helpers.js";
import { setupSocket } from "../socket.js";

let ctx: ReturnType<typeof createTestContext>;
let token: string;
let httpServer: ReturnType<typeof createServer>;
let port: number;

function connectClient(authToken: string): Promise<ClientSocket> {
  return new Promise((resolve, reject) => {
    const client = ioClient(`http://localhost:${port}`, {
      auth: { token: authToken },
      transports: ["websocket"],
    });
    client.on("connect", () => resolve(client));
    client.on("connect_error", (err) => reject(err));
  });
}

beforeEach(async () => {
  ctx = createTestContext();
  const user = await createTestUser(ctx.db, { role: "admin" });
  token = user.token;

  httpServer = createServer(ctx.app);
  setupSocket(httpServer);

  await new Promise<void>((resolve) => {
    httpServer.listen(0, () => {
      const addr = httpServer.address();
      port = typeof addr === "object" && addr ? addr.port : 0;
      resolve();
    });
  });
});

afterEach(async () => {
  await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  closeTestContext(ctx);
});

describe("Socket.io", () => {
  it("connects with valid JWT", async () => {
    const client = await connectClient(token);
    expect(client.connected).toBe(true);
    client.disconnect();
  });

  it("rejects connection without token", async () => {
    await expect(
      new Promise((resolve, reject) => {
        const client = ioClient(`http://localhost:${port}`, {
          auth: {},
          transports: ["websocket"],
        });
        client.on("connect", () => {
          client.disconnect();
          resolve(true);
        });
        client.on("connect_error", (err) => {
          client.disconnect();
          reject(err);
        });
      }),
    ).rejects.toThrow();
  });

  it("rejects connection with invalid token", async () => {
    await expect(connectClient("invalid-token")).rejects.toThrow();
  });

  it("receives node:created broadcast", async () => {
    const client = await connectClient(token);

    const eventPromise = new Promise<Record<string, unknown>>((resolve) => {
      client.on("node:created", (payload: Record<string, unknown>) => resolve(payload));
    });

    // Use the httpServer so broadcast fires through the same process
    await request(httpServer)
      .post("/api/nodes")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Broadcast Test" });

    const payload = await eventPromise;
    expect(payload.name).toBe("Broadcast Test");

    client.disconnect();
  });

  it("receives node:deleted broadcast", async () => {
    const client = await connectClient(token);

    // Create a node first
    const createRes = await request(httpServer)
      .post("/api/nodes")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "To Delete" });

    const nodeId = createRes.body.id;

    const eventPromise = new Promise<Record<string, unknown>>((resolve) => {
      client.on("node:deleted", (payload: Record<string, unknown>) => resolve(payload));
    });

    await request(httpServer)
      .delete(`/api/nodes/${nodeId}`)
      .set("Authorization", `Bearer ${token}`);

    const payload = await eventPromise;
    expect(payload.id).toBe(nodeId);

    client.disconnect();
  });
});
