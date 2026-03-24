import bcrypt from "bcrypt";
import { count } from "drizzle-orm";
import { users } from "@rome/shared/schema";
import type { Db } from "./db.js";

/**
 * Seeds a default admin user when the users table is empty.
 * This ensures `admin / password123` works immediately after `npm run dev`.
 */
export async function seedDb(db: Db): Promise<void> {
  const [result] = db.select({ value: count() }).from(users).all();
  if (result!.value > 0) return;

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
