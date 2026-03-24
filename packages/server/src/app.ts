import express from "express";
import type { Db } from "./db.js";
import { authRoutes } from "./routes/auth.js";
import { nodeRoutes } from "./routes/nodes.js";
import { edgeRoutes } from "./routes/edges.js";
import { graphRoutes, budgetRoutes } from "./routes/graph.js";
import { authMiddleware } from "./middleware/auth.js";

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

  return app;
}
