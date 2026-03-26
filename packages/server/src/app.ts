import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import type { Db } from "./db.js";
import { authRoutes } from "./routes/auth.js";
import { nodeRoutes } from "./routes/nodes.js";
import { edgeRoutes } from "./routes/edges.js";
import { graphRoutes, budgetRoutes } from "./routes/graph.js";
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

  // MCP endpoint — mounted BEFORE static middleware so /mcp isn't caught by SPA catch-all
  const mcpHandler = createMcpHandler(db);
  app.all(["/mcp", "/mcp/*"], mcpHandler);

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
