/**
 * Seeds the database with 31 nodes across 3 workstreams (Halo MVP, Orcrest, LAPD)
 * plus edges (blocks and parent_of) for E2E verification.
 *
 * Usage: npx tsx packages/server/src/seed.ts
 */

import { createDb, initTables } from "./db.js";
import * as schema from "@rome/shared/schema";
import { eq } from "drizzle-orm";
import bcrypt from "bcrypt";

const dbPath = process.env["DATABASE_PATH"] || "rome.db";
const { db, sqlite } = createDb(dbPath);
initTables(sqlite);

const now = new Date().toISOString();

// Create seed user
const userId = "seed-user-001";
const existing = db.select().from(schema.users).where(eq(schema.users.id, userId)).get();
if (!existing) {
  const hash = await bcrypt.hash("password123", 10);
  db.insert(schema.users).values({
    id: userId,
    username: "admin",
    email: "admin@rome.dev",
    passwordHash: hash,
    role: "admin",
    createdAt: now,
    updatedAt: now,
  }).run();
}

// Helper
let nodeCounter = 0;
function makeNode(
  name: string,
  workstream: string,
  opts: {
    status?: string;
    priority?: string;
    startDate?: string;
    endDate?: string;
    budget?: number;
    deliverable?: string;
    notes?: string;
    raci?: object;
  } = {},
) {
  nodeCounter++;
  const id = `node-${String(nodeCounter).padStart(3, "0")}`;
  return {
    id,
    name,
    status: opts.status ?? "not_started",
    priority: opts.priority ?? "P2",
    startDate: opts.startDate ?? null,
    endDate: opts.endDate ?? null,
    budget: opts.budget ?? null,
    deliverable: opts.deliverable ?? null,
    notes: opts.notes ?? null,
    raci: opts.raci ? JSON.stringify(opts.raci) : null,
    workstream,
    x: null,
    y: null,
    positionPinned: 0,
    attachments: null,
    createdBy: userId,
    createdAt: now,
    updatedAt: now,
  };
}

// ─── Halo MVP (12 nodes) ───
const haloMvp = [
  makeNode("Halo MVP", "Halo MVP", {
    status: "in_progress", priority: "P0", budget: 500000,
    startDate: "2026-01-15", endDate: "2026-06-30",
    deliverable: "Launch-ready Halo product with core feature set",
    notes: "Primary initiative for Q1-Q2. All-hands priority.",
    raci: { R: "Engineering", A: "VP Product", C: "Design", I: "Sales" },
  }),
  makeNode("Auth & Onboarding", "Halo MVP", {
    status: "done", priority: "P0", budget: 60000,
    startDate: "2026-01-15", endDate: "2026-02-28",
    deliverable: "OAuth + email login, onboarding flow",
    notes: "Shipped ahead of schedule",
    raci: { R: "Auth Team", A: "Tech Lead", C: "Security", I: "Support" },
  }),
  makeNode("Core API", "Halo MVP", {
    status: "done", priority: "P0", budget: 80000,
    startDate: "2026-02-01", endDate: "2026-03-15",
    deliverable: "REST + GraphQL API v1",
    raci: { R: "Backend", A: "Architect", C: "Frontend", I: "QA" },
  }),
  makeNode("Dashboard UI", "Halo MVP", {
    status: "in_progress", priority: "P0", budget: 70000,
    startDate: "2026-03-01", endDate: "2026-04-15",
    deliverable: "Real-time dashboard with charts and widgets",
    notes: "Blocked briefly on design approvals, now moving",
    raci: { R: "Frontend", A: "Design Lead", C: "Product", I: "Marketing" },
  }),
  makeNode("Data Pipeline", "Halo MVP", {
    status: "in_progress", priority: "P1", budget: 90000,
    startDate: "2026-02-15", endDate: "2026-04-30",
    deliverable: "ETL pipeline for customer data ingestion",
    raci: { R: "Data Eng", A: "Tech Lead", C: "Security", I: "Analytics" },
  }),
  makeNode("Notification System", "Halo MVP", {
    status: "not_started", priority: "P1", budget: 40000,
    startDate: "2026-04-01", endDate: "2026-05-15",
    deliverable: "Email, push, and in-app notifications",
    raci: { R: "Backend", A: "Product", C: "Design", I: "Support" },
  }),
  makeNode("Search & Filtering", "Halo MVP", {
    status: "blocked", priority: "P1", budget: 35000,
    startDate: "2026-03-15", endDate: "2026-04-30",
    deliverable: "Full-text search with filters",
    notes: "Blocked on Data Pipeline completion for indexing",
    raci: { R: "Backend", A: "Tech Lead", C: "Frontend", I: "QA" },
  }),
  makeNode("Mobile Responsive", "Halo MVP", {
    status: "not_started", priority: "P2", budget: 25000,
    startDate: "2026-05-01", endDate: "2026-05-31",
    deliverable: "Responsive layouts for mobile/tablet",
    raci: { R: "Frontend", A: "Design Lead", C: "QA", I: "Product" },
  }),
  makeNode("Analytics Integration", "Halo MVP", {
    status: "not_started", priority: "P2", budget: 30000,
    startDate: "2026-05-01", endDate: "2026-06-15",
    deliverable: "Mixpanel + internal analytics dashboard",
    raci: { R: "Data Eng", A: "Product", C: "Engineering", I: "Marketing" },
  }),
  makeNode("Performance Optimization", "Halo MVP", {
    status: "not_started", priority: "P2", budget: 20000,
    startDate: "2026-05-15", endDate: "2026-06-15",
    deliverable: "Sub-200ms P99 latency",
    raci: { R: "Backend", A: "Architect", C: "SRE", I: "QA" },
  }),
  makeNode("Beta Testing", "Halo MVP", {
    status: "not_started", priority: "P1", budget: 15000,
    startDate: "2026-06-01", endDate: "2026-06-20",
    deliverable: "Beta cohort feedback report",
    raci: { R: "QA", A: "Product", C: "Support", I: "Engineering" },
  }),
  makeNode("Launch Prep", "Halo MVP", {
    status: "not_started", priority: "P0", budget: 35000,
    startDate: "2026-06-15", endDate: "2026-06-30",
    deliverable: "Go-to-market assets and launch checklist",
    raci: { R: "Marketing", A: "VP Product", C: "Sales", I: "Engineering" },
  }),
];

// ─── Orcrest (10 nodes) ───
const orcrest = [
  makeNode("Orcrest Platform", "Orcrest", {
    status: "in_progress", priority: "P1", budget: 350000,
    startDate: "2026-02-01", endDate: "2026-07-31",
    deliverable: "Enterprise platform with multi-tenant support",
    notes: "Second priority after Halo MVP",
    raci: { R: "Platform Team", A: "CTO", C: "Security", I: "Sales" },
  }),
  makeNode("Tenant Isolation", "Orcrest", {
    status: "done", priority: "P0", budget: 50000,
    startDate: "2026-02-01", endDate: "2026-03-15",
    deliverable: "Data isolation per tenant with row-level security",
    raci: { R: "Security Eng", A: "Architect", C: "Legal", I: "Compliance" },
  }),
  makeNode("Admin Console", "Orcrest", {
    status: "in_progress", priority: "P1", budget: 45000,
    startDate: "2026-03-01", endDate: "2026-04-30",
    deliverable: "Admin UI for tenant management",
    raci: { R: "Frontend", A: "Product", C: "Support", I: "Sales" },
  }),
  makeNode("Billing & Metering", "Orcrest", {
    status: "not_started", priority: "P1", budget: 55000,
    startDate: "2026-04-01", endDate: "2026-05-31",
    deliverable: "Usage-based billing with Stripe integration",
    notes: "Depends on Admin Console for tenant billing config",
    raci: { R: "Backend", A: "Finance", C: "Legal", I: "Product" },
  }),
  makeNode("SSO Integration", "Orcrest", {
    status: "in_progress", priority: "P0", budget: 30000,
    startDate: "2026-03-01", endDate: "2026-04-15",
    deliverable: "SAML + OIDC enterprise SSO",
    raci: { R: "Auth Team", A: "Security Lead", C: "Sales", I: "Support" },
  }),
  makeNode("Audit Logging", "Orcrest", {
    status: "not_started", priority: "P1", budget: 25000,
    startDate: "2026-04-15", endDate: "2026-05-31",
    deliverable: "Immutable audit trail for compliance",
    raci: { R: "Backend", A: "Compliance", C: "Security", I: "Legal" },
  }),
  makeNode("API Rate Limiting", "Orcrest", {
    status: "not_started", priority: "P2", budget: 20000,
    startDate: "2026-05-01", endDate: "2026-05-31",
    deliverable: "Per-tenant rate limiting and quotas",
    raci: { R: "Platform Team", A: "Architect", C: "SRE", I: "Support" },
  }),
  makeNode("Data Export", "Orcrest", {
    status: "not_started", priority: "P2", budget: 15000,
    startDate: "2026-05-15", endDate: "2026-06-30",
    deliverable: "CSV/JSON bulk export with scheduling",
    raci: { R: "Backend", A: "Product", C: "Support", I: "Sales" },
  }),
  makeNode("SLA Dashboard", "Orcrest", {
    status: "blocked", priority: "P1", budget: 35000,
    startDate: "2026-05-01", endDate: "2026-06-30",
    deliverable: "Uptime and SLA monitoring for enterprise clients",
    notes: "Blocked on Audit Logging for data source",
    raci: { R: "SRE", A: "CTO", C: "Product", I: "Sales" },
  }),
  makeNode("Orcrest Beta", "Orcrest", {
    status: "not_started", priority: "P1", budget: 25000,
    startDate: "2026-07-01", endDate: "2026-07-31",
    deliverable: "Enterprise beta program with 3 pilot customers",
    raci: { R: "Product", A: "CTO", C: "Sales", I: "Engineering" },
  }),
];

// ─── LAPD (9 nodes) ───
const lapd = [
  makeNode("LAPD Integration", "LAPD", {
    status: "in_progress", priority: "P1", budget: 280000,
    startDate: "2026-03-01", endDate: "2026-08-31",
    deliverable: "Complete LAPD system integration",
    notes: "Government contract, strict compliance requirements",
    raci: { R: "Gov Team", A: "VP Engineering", C: "Legal", I: "Compliance" },
  }),
  makeNode("Compliance Framework", "LAPD", {
    status: "done", priority: "P0", budget: 40000,
    startDate: "2026-03-01", endDate: "2026-03-20",
    deliverable: "FedRAMP-aligned compliance documentation",
    raci: { R: "Compliance", A: "Legal", C: "Security", I: "Engineering" },
  }),
  makeNode("Secure Data Layer", "LAPD", {
    status: "in_progress", priority: "P0", budget: 60000,
    startDate: "2026-03-15", endDate: "2026-05-15",
    deliverable: "Encrypted at-rest and in-transit data layer",
    raci: { R: "Security Eng", A: "Architect", C: "Compliance", I: "SRE" },
  }),
  makeNode("Records Management", "LAPD", {
    status: "not_started", priority: "P1", budget: 45000,
    startDate: "2026-05-01", endDate: "2026-06-30",
    deliverable: "Document management with retention policies",
    notes: "Waiting on Secure Data Layer",
    raci: { R: "Backend", A: "Product", C: "Legal", I: "Compliance" },
  }),
  makeNode("Incident Reporting", "LAPD", {
    status: "not_started", priority: "P1", budget: 35000,
    startDate: "2026-05-15", endDate: "2026-07-15",
    deliverable: "Real-time incident capture and workflow",
    raci: { R: "Frontend", A: "Product", C: "Gov Team", I: "QA" },
  }),
  makeNode("Field Mobile App", "LAPD", {
    status: "not_started", priority: "P2", budget: 30000,
    startDate: "2026-06-01", endDate: "2026-07-31",
    deliverable: "Offline-capable mobile app for field officers",
    raci: { R: "Mobile Team", A: "Product", C: "Gov Team", I: "QA" },
  }),
  makeNode("GIS Mapping", "LAPD", {
    status: "cancelled", priority: "P3", budget: 20000,
    deliverable: "Geographic incident mapping",
    notes: "Descoped - using third-party GIS instead",
    raci: { R: "Backend", A: "Product", C: "Gov Team", I: "Engineering" },
  }),
  makeNode("Security Audit", "LAPD", {
    status: "not_started", priority: "P0", budget: 25000,
    startDate: "2026-07-15", endDate: "2026-08-15",
    deliverable: "Third-party penetration test and audit report",
    raci: { R: "Security", A: "VP Engineering", C: "Compliance", I: "Legal" },
  }),
  makeNode("LAPD Go-Live", "LAPD", {
    status: "not_started", priority: "P0", budget: 25000,
    startDate: "2026-08-15", endDate: "2026-08-31",
    deliverable: "Production deployment with support handoff",
    raci: { R: "SRE", A: "VP Engineering", C: "Gov Team", I: "Support" },
  }),
];

const allNodes = [...haloMvp, ...orcrest, ...lapd];

// Insert all nodes
for (const n of allNodes) {
  const exists = db.select().from(schema.nodes).where(eq(schema.nodes.id, n.id)).get();
  if (!exists) {
    db.insert(schema.nodes).values(n as any).run();
  }
}

// ─── Edges ───
let edgeCounter = 0;
function makeEdge(sourceId: string, targetId: string, type: "blocks" | "parent_of") {
  edgeCounter++;
  return {
    id: `edge-${String(edgeCounter).padStart(3, "0")}`,
    sourceId,
    targetId,
    type,
    createdBy: userId,
    createdAt: now,
    updatedAt: now,
  };
}

const nodeIds = Object.fromEntries(allNodes.map((n) => [n.name, n.id]));
const n = (name: string) => nodeIds[name]!;

const allEdges = [
  // Halo MVP parent_of
  makeEdge(n("Halo MVP"), n("Auth & Onboarding"), "parent_of"),
  makeEdge(n("Halo MVP"), n("Core API"), "parent_of"),
  makeEdge(n("Halo MVP"), n("Dashboard UI"), "parent_of"),
  makeEdge(n("Halo MVP"), n("Data Pipeline"), "parent_of"),
  makeEdge(n("Halo MVP"), n("Notification System"), "parent_of"),
  makeEdge(n("Halo MVP"), n("Search & Filtering"), "parent_of"),
  makeEdge(n("Halo MVP"), n("Mobile Responsive"), "parent_of"),
  makeEdge(n("Halo MVP"), n("Analytics Integration"), "parent_of"),
  makeEdge(n("Halo MVP"), n("Performance Optimization"), "parent_of"),
  makeEdge(n("Halo MVP"), n("Beta Testing"), "parent_of"),
  makeEdge(n("Halo MVP"), n("Launch Prep"), "parent_of"),

  // Halo MVP blocks
  makeEdge(n("Core API"), n("Dashboard UI"), "blocks"),
  makeEdge(n("Data Pipeline"), n("Search & Filtering"), "blocks"),
  makeEdge(n("Dashboard UI"), n("Mobile Responsive"), "blocks"),
  makeEdge(n("Dashboard UI"), n("Analytics Integration"), "blocks"),
  makeEdge(n("Core API"), n("Performance Optimization"), "blocks"),
  makeEdge(n("Performance Optimization"), n("Beta Testing"), "blocks"),
  makeEdge(n("Beta Testing"), n("Launch Prep"), "blocks"),

  // Orcrest parent_of
  makeEdge(n("Orcrest Platform"), n("Tenant Isolation"), "parent_of"),
  makeEdge(n("Orcrest Platform"), n("Admin Console"), "parent_of"),
  makeEdge(n("Orcrest Platform"), n("Billing & Metering"), "parent_of"),
  makeEdge(n("Orcrest Platform"), n("SSO Integration"), "parent_of"),
  makeEdge(n("Orcrest Platform"), n("Audit Logging"), "parent_of"),
  makeEdge(n("Orcrest Platform"), n("API Rate Limiting"), "parent_of"),
  makeEdge(n("Orcrest Platform"), n("Data Export"), "parent_of"),
  makeEdge(n("Orcrest Platform"), n("SLA Dashboard"), "parent_of"),
  makeEdge(n("Orcrest Platform"), n("Orcrest Beta"), "parent_of"),

  // Orcrest blocks
  makeEdge(n("Tenant Isolation"), n("Admin Console"), "blocks"),
  makeEdge(n("Admin Console"), n("Billing & Metering"), "blocks"),
  makeEdge(n("SSO Integration"), n("Admin Console"), "blocks"),
  makeEdge(n("Audit Logging"), n("SLA Dashboard"), "blocks"),
  makeEdge(n("Billing & Metering"), n("Orcrest Beta"), "blocks"),

  // LAPD parent_of
  makeEdge(n("LAPD Integration"), n("Compliance Framework"), "parent_of"),
  makeEdge(n("LAPD Integration"), n("Secure Data Layer"), "parent_of"),
  makeEdge(n("LAPD Integration"), n("Records Management"), "parent_of"),
  makeEdge(n("LAPD Integration"), n("Incident Reporting"), "parent_of"),
  makeEdge(n("LAPD Integration"), n("Field Mobile App"), "parent_of"),
  makeEdge(n("LAPD Integration"), n("GIS Mapping"), "parent_of"),
  makeEdge(n("LAPD Integration"), n("Security Audit"), "parent_of"),
  makeEdge(n("LAPD Integration"), n("LAPD Go-Live"), "parent_of"),

  // LAPD blocks
  makeEdge(n("Compliance Framework"), n("Secure Data Layer"), "blocks"),
  makeEdge(n("Secure Data Layer"), n("Records Management"), "blocks"),
  makeEdge(n("Records Management"), n("Incident Reporting"), "blocks"),
  makeEdge(n("Secure Data Layer"), n("Field Mobile App"), "blocks"),
  makeEdge(n("Incident Reporting"), n("Security Audit"), "blocks"),
  makeEdge(n("Security Audit"), n("LAPD Go-Live"), "blocks"),
];

for (const e of allEdges) {
  const exists = db.select().from(schema.edges).where(eq(schema.edges.id, e.id)).get();
  if (!exists) {
    db.insert(schema.edges).values(e as any).run();
  }
}

console.log(`Seeded ${allNodes.length} nodes and ${allEdges.length} edges`);
console.log(`Workstreams: Halo MVP (${haloMvp.length}), Orcrest (${orcrest.length}), LAPD (${lapd.length})`);
console.log(`Login: admin / password123`);
