import { sqliteTable, text, real, integer } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  username: text("username").notNull().unique(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  role: text("role", { enum: ["admin", "member"] }).notNull().default("member"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const nodes = sqliteTable("nodes", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  status: text("status").notNull().default("not_started"),
  priority: text("priority").notNull().default("P2"),
  startDate: text("start_date"),
  endDate: text("end_date"),
  budget: real("budget"),
  deliverable: text("deliverable"),
  notes: text("notes"),
  raci: text("raci"),
  workstream: text("workstream"),
  x: real("x"),
  y: real("y"),
  positionPinned: integer("position_pinned").default(0),
  attachments: text("attachments"),
  createdBy: text("created_by")
    .notNull()
    .references(() => users.id),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const edges = sqliteTable("edges", {
  id: text("id").primaryKey(),
  sourceId: text("source_id")
    .notNull()
    .references(() => nodes.id, { onDelete: "cascade" }),
  targetId: text("target_id")
    .notNull()
    .references(() => nodes.id, { onDelete: "cascade" }),
  type: text("type").notNull(),
  createdBy: text("created_by")
    .notNull()
    .references(() => users.id),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});
