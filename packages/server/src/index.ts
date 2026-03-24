import { createServer } from "node:http";
import { createDb, initTables } from "./db.js";
import { createApp } from "./app.js";
import { setupSocket } from "./socket.js";

const PORT = parseInt(process.env["PORT"] || "3000", 10);

const dbPath = process.env["DATABASE_PATH"] || "rome.db";
const { db, sqlite } = createDb(dbPath);
initTables(sqlite);

const app = createApp(db);
const httpServer = createServer(app);
setupSocket(httpServer);

httpServer.listen(PORT, () => {
  console.log(`Rome server listening on port ${PORT}`);
});
