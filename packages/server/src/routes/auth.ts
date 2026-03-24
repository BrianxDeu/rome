import { Router } from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { v4 as uuid } from "uuid";
import { eq, count } from "drizzle-orm";
import { users } from "@rome/shared/schema";
import type {
  RegisterRequest,
  LoginRequest,
  PublicUser,
} from "@rome/shared";
import type { Db } from "../db.js";
import { getJwtSecret } from "../middleware/auth.js";

function toPublicUser(
  row: typeof users.$inferSelect,
): PublicUser {
  return {
    id: row.id,
    username: row.username,
    email: row.email,
    role: row.role,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function authRoutes(db: Db): Router {
  const router = Router();

  router.post("/register", async (req, res) => {
    try {
      const { username, email, password } = req.body as RegisterRequest;

      if (!username || !email || !password) {
        res.status(400).json({ error: "username, email, and password are required" });
        return;
      }

      if (password.length < 8) {
        res.status(400).json({ error: "Password must be at least 8 characters" });
        return;
      }

      const existing = db
        .select()
        .from(users)
        .where(eq(users.username, username))
        .get();

      if (existing) {
        res.status(409).json({ error: "Username already taken" });
        return;
      }

      const existingEmail = db
        .select()
        .from(users)
        .where(eq(users.email, email))
        .get();

      if (existingEmail) {
        res.status(409).json({ error: "Email already registered" });
        return;
      }

      // First user becomes admin
      const [userCount] = db.select({ value: count() }).from(users).all();
      const isFirstUser = userCount!.value === 0;

      const now = new Date().toISOString();
      const passwordHash = await bcrypt.hash(password, 10);
      const id = uuid();

      const newUser = {
        id,
        username,
        email,
        passwordHash,
        role: isFirstUser ? "admin" as const : "member" as const,
        createdAt: now,
        updatedAt: now,
      };

      db.insert(users).values(newUser).run();

      const token = jwt.sign(
        { userId: id, role: newUser.role },
        getJwtSecret(),
        { expiresIn: "7d" },
      );

      res.status(201).json({
        token,
        user: toPublicUser(newUser),
      });
    } catch (err) {
      res.status(500).json({ error: "Internal server error" });
    }
  });

  router.post("/login", async (req, res) => {
    try {
      const { username, password } = req.body as LoginRequest;

      if (!username || !password) {
        res.status(400).json({ error: "username and password are required" });
        return;
      }

      const user = db
        .select()
        .from(users)
        .where(eq(users.username, username))
        .get();

      if (!user) {
        res.status(401).json({ error: "Invalid credentials" });
        return;
      }

      const valid = await bcrypt.compare(password, user.passwordHash);
      if (!valid) {
        res.status(401).json({ error: "Invalid credentials" });
        return;
      }

      const token = jwt.sign(
        { userId: user.id, role: user.role },
        getJwtSecret(),
        { expiresIn: "7d" },
      );

      res.json({
        token,
        user: toPublicUser(user),
      });
    } catch (err) {
      res.status(500).json({ error: "Internal server error" });
    }
  });

  return router;
}
