import Database from "better-sqlite3";
import type BetterSqlite3 from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "@rome/shared/schema";
import { createApp } from "../app.js";
import { initTables } from "../db.js";

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
