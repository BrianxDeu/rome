import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import type { AuthPayload } from "@rome/shared";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} environment variable is required`);
  return value;
}

const JWT_SECRET: string = requireEnv("JWT_SECRET");

export function getJwtSecret(): string {
  return JWT_SECRET;
}

export function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Missing or invalid authorization header" });
    return;
  }

  const token = header.slice(7);
  try {
    const payload = jwt.verify(token, JWT_SECRET) as AuthPayload;
    req.auth = payload;
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired token" });
  }
}

export function requireAdmin(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (req.auth?.role !== "admin") {
    res.status(403).json({ error: "Admin access required" });
    return;
  }
  next();
}

declare global {
  namespace Express {
    interface Request {
      auth?: AuthPayload;
    }
  }
}
