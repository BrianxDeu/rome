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
  sortOrder: integer("sort_order"),
  kanbanSortOrder: integer("kanban_sort_order"),
  attachments: text("attachments"),
  completedBy: text("completed_by"),
  completedAt: text("completed_at"),
  archivedAt: text("archived_at"),
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

export const auditLog = sqliteTable("audit_log", {
  id: text("id").primaryKey(),
  toolName: text("tool_name").notNull(),
  userId: text("user_id").notNull(),
  requestSummary: text("request_summary").notNull(),
  affectedNodeIds: text("affected_node_ids").notNull().default("[]"),
  changesJson: text("changes_json").notNull(),
  verificationResult: text("verification_result").notNull().default("pending"),
  createdAt: text("created_at").notNull(),
});

export const personalTasks = sqliteTable("personal_tasks", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id),
  text: text("text").notNull(),
  priority: text("priority").notNull().default("P1"),
  done: integer("done").notNull().default(0),
  doneAt: text("done_at"),
  createdAt: text("created_at").notNull(),
});

export const oauthClients = sqliteTable("oauth_clients", {
  clientId: text("client_id").primaryKey(),
  clientName: text("client_name"),
  redirectUris: text("redirect_uris").notNull().default("[]"),
  createdAt: text("created_at").notNull(),
});

export const oauthTokens = sqliteTable("oauth_tokens", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  refreshToken: text("refresh_token").notNull().unique(),
  expiresAt: text("expires_at").notNull(),
  createdAt: text("created_at").notNull(),
});
