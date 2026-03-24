import Database from "better-sqlite3";
import type BetterSqlite3 from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import * as schema from "@rome/shared/schema";
import { createApp } from "../app.js";
import { initTables } from "../db.js";
import { getJwtSecret } from "../middleware/auth.js";

export function createTestContext(): { db: ReturnType<typeof drizzle<typeof schema>>; sqlite: BetterSqlite3.Database; app: ReturnType<typeof createApp> } {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema });
  initTables(sqlite);
  const app = createApp(db);
  return { db, sqlite, app };
}

export function closeTestContext(ctx: { sqlite: BetterSqlite3.Database }) {
  ctx.sqlite.close();
}

export async function createTestUser(
  db: ReturnType<typeof drizzle<typeof schema>>,
  opts: { username?: string; email?: string; password?: string; role?: "admin" | "member" } = {},
): Promise<{ id: string; token: string; username: string }> {
  const id = crypto.randomUUID();
  const username = opts.username ?? "testuser";
  const email = opts.email ?? `${username}@test.com`;
  const password = opts.password ?? "password123";
  const role = opts.role ?? "member";
  const now = new Date().toISOString();
  const passwordHash = await bcrypt.hash(password, 4); // low rounds for speed

  db.insert(schema.users)
    .values({ id, username, email, passwordHash, role, createdAt: now, updatedAt: now })
    .run();

  const token = jwt.sign({ userId: id, role }, getJwtSecret(), { expiresIn: "1h" });
  return { id, token, username };
}
