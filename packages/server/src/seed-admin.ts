import bcrypt from "bcrypt";
import { eq, count } from "drizzle-orm";
import { users } from "@rome/shared/schema";
import type { Db } from "./db.js";
import { MCP_SERVICE_USER_ID } from "./mcp/server.js";

/**
 * Seeds a default admin user when the users table is empty.
 * This ensures `admin / password123` works immediately after `npm run dev`.
 * Also ensures the MCP service account exists (idempotent).
 */
export async function seedDb(db: Db): Promise<void> {
  const [result] = db.select({ value: count() }).from(users).all();
  if (result!.value === 0) {
    const now = new Date().toISOString();
    const passwordHash = await bcrypt.hash("password123", 10);

    db.insert(users)
      .values({
        id: "seed-user-001",
        username: "admin",
        email: "admin@rome.dev",
        passwordHash,
        role: "admin",
        createdAt: now,
        updatedAt: now,
      })
      .run();

    console.log("Seeded default admin user (admin / password123)");
  }

  // Ensure MCP service account exists (idempotent)
  const mcpUser = db.select().from(users).where(eq(users.id, MCP_SERVICE_USER_ID)).get();
  if (!mcpUser) {
    const now = new Date().toISOString();
    db.insert(users)
      .values({
        id: MCP_SERVICE_USER_ID,
        username: "mcp-service",
        email: "mcp@dxd.internal",
        passwordHash: "no-login",
        role: "member",
        createdAt: now,
        updatedAt: now,
      })
      .run();

    console.log("Seeded MCP service account");
  }
}
