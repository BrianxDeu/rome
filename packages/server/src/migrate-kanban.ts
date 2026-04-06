/**
 * Kanban Migration: Add kanban_sort_order column to nodes table
 * Usage: npx tsx packages/server/src/migrate-kanban.ts
 * Idempotent — safe to run multiple times.
 */
import Database from "better-sqlite3";

const dbPath = process.env["DATABASE_PATH"] || "rome.db";
const db = new Database(dbPath);

// Check if column already exists
const cols = db.pragma("table_info(nodes)") as { name: string }[];
const hasColumn = cols.some((c) => c.name === "kanban_sort_order");

if (hasColumn) {
  console.log("kanban_sort_order column already exists — skipping.");
} else {
  db.exec("ALTER TABLE nodes ADD COLUMN kanban_sort_order INTEGER");
  console.log("Added kanban_sort_order column to nodes table.");
}

db.close();
