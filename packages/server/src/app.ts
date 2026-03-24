import express from "express";
import type { Db } from "./db.js";
import { authRoutes } from "./routes/auth.js";

export function createApp(db: Db) {
  const app = express();

  app.use(express.json());

  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  app.use("/api/auth", authRoutes(db));

  return app;
}
