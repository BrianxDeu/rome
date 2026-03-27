import { createServer } from "node:http";
import { sql } from "drizzle-orm";
import { createDb, initTables } from "./db.js";
import { createApp } from "./app.js";
import { setupSocket } from "./socket.js";
import { seedDb } from "./seed-admin.js";

const PORT = parseInt(process.env["PORT"] || "3000", 10);

const dbPath = process.env["DATABASE_PATH"] || "rome.db";
const { db, sqlite } = createDb(dbPath);
initTables(sqlite);
await seedDb(db);

const app = createApp(db);
const httpServer = createServer(app);
setupSocket(httpServer);

// Clean up stale done tasks (checked > 2 minutes ago)
function cleanupStaleTasks() {
  try {
    db.run(sql`DELETE FROM personal_tasks WHERE done = 1 AND done_at < datetime('now', '-2 minutes')`);
  } catch (err) {
    console.error("[cleanup] stale task cleanup failed:", err);
  }
}
cleanupStaleTasks();
setInterval(cleanupStaleTasks, 5 * 60 * 1000);

// Graceful shutdown — let in-flight requests finish before dying
process.on("SIGTERM", () => {
  console.log("[shutdown] SIGTERM received, closing server...");
  httpServer.close(() => {
    console.log("[shutdown] Server closed gracefully");
    process.exit(0);
  });
  setTimeout(() => {
    console.error("[shutdown] Forced exit after 10s timeout");
    process.exit(1);
  }, 10_000);
});

httpServer.listen(PORT, () => {
  console.log(`Rome server listening on port ${PORT}`);
});
