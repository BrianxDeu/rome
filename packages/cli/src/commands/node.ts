import { Command } from "commander";
import { api } from "../api.js";
import type { Node } from "@rome/shared/types";

function printNode(node: Node & { edges?: unknown[] }): void {
  console.log(`ID:         ${node.id}`);
  console.log(`Name:       ${node.name}`);
  console.log(`Status:     ${node.status}`);
  console.log(`Priority:   ${node.priority}`);
  if (node.workstream) console.log(`Workstream: ${node.workstream}`);
  if (node.budget !== null) console.log(`Budget:     ${node.budget}`);
  if (node.deliverable) console.log(`Deliverable: ${node.deliverable}`);
  if (node.startDate) console.log(`Start:      ${node.startDate}`);
  if (node.endDate) console.log(`End:        ${node.endDate}`);
  if (node.notes) console.log(`Notes:      ${node.notes}`);
  if (node.edges && node.edges.length > 0) {
    console.log(`Edges:      ${node.edges.length}`);
  }
}

function printNodeRow(node: Node): void {
  const parts = [
    node.id.slice(0, 8),
    node.status.padEnd(12),
    node.priority,
    node.name,
  ];
  if (node.workstream) parts.push(`[${node.workstream}]`);
  console.log(parts.join("  "));
}

export const nodeCommand = new Command("node").description(
  "Manage project nodes",
);

nodeCommand
  .command("list")
  .description("List nodes")
  .option("-w, --workstream <workstream>", "Filter by workstream")
  .option("-s, --status <status>", "Filter by status")
  .option("-p, --priority <priority>", "Filter by priority")
  .option("--json", "Output as JSON")
  .action(async (opts) => {
    const query: Record<string, string> = {};
    if (opts.workstream) query.workstream = opts.workstream;
    if (opts.status) query.status = opts.status;
    if (opts.priority) query.priority = opts.priority;

    const nodes = (await api.get("/api/nodes", query)) as Node[];

    if (opts.json) {
      console.log(JSON.stringify(nodes, null, 2));
      return;
    }

    if (nodes.length === 0) {
      console.log("No nodes found.");
      return;
    }

    for (const node of nodes) {
      printNodeRow(node);
    }
  });

nodeCommand
  .command("get <id>")
  .description("Get a node by ID")
  .option("--json", "Output as JSON")
  .action(async (id, opts) => {
    const node = (await api.get(`/api/nodes/${id}`)) as Node & {
      edges: unknown[];
    };

    if (opts.json) {
      console.log(JSON.stringify(node, null, 2));
      return;
    }

    printNode(node);
  });

nodeCommand
  .command("create")
  .description("Create a new node")
  .requiredOption("-n, --name <name>", "Node name")
  .option(
    "-s, --status <status>",
    "Status (not_started|in_progress|blocked|done|cancelled)",
  )
  .option("-p, --priority <priority>", "Priority (P0|P1|P2|P3)")
  .option("-w, --workstream <workstream>", "Workstream")
  .option("-b, --budget <budget>", "Budget amount")
  .option("-d, --deliverable <deliverable>", "Deliverable description")
  .option("--notes <notes>", "Notes")
  .option("--start-date <date>", "Start date")
  .option("--end-date <date>", "End date")
  .option("--json", "Output as JSON")
  .action(async (opts) => {
    const body: Record<string, unknown> = { name: opts.name };
    if (opts.status) body.status = opts.status;
    if (opts.priority) body.priority = opts.priority;
    if (opts.workstream) body.workstream = opts.workstream;
    if (opts.budget) body.budget = Number(opts.budget);
    if (opts.deliverable) body.deliverable = opts.deliverable;
    if (opts.notes) body.notes = opts.notes;
    if (opts.startDate) body.start_date = opts.startDate;
    if (opts.endDate) body.end_date = opts.endDate;

    const node = (await api.post("/api/nodes", body)) as Node;

    if (opts.json) {
      console.log(JSON.stringify(node, null, 2));
      return;
    }

    console.log(`Created node ${node.id}`);
    printNode(node);
  });

nodeCommand
  .command("update <id>")
  .description("Update a node")
  .option("-n, --name <name>", "Node name")
  .option(
    "-s, --status <status>",
    "Status (not_started|in_progress|blocked|done|cancelled)",
  )
  .option("-p, --priority <priority>", "Priority (P0|P1|P2|P3)")
  .option("-w, --workstream <workstream>", "Workstream")
  .option("-b, --budget <budget>", "Budget amount")
  .option("-d, --deliverable <deliverable>", "Deliverable description")
  .option("--notes <notes>", "Notes")
  .option("--start-date <date>", "Start date")
  .option("--end-date <date>", "End date")
  .option("--json", "Output as JSON")
  .action(async (id, opts) => {
    const body: Record<string, unknown> = {};
    if (opts.name) body.name = opts.name;
    if (opts.status) body.status = opts.status;
    if (opts.priority) body.priority = opts.priority;
    if (opts.workstream) body.workstream = opts.workstream;
    if (opts.budget) body.budget = Number(opts.budget);
    if (opts.deliverable) body.deliverable = opts.deliverable;
    if (opts.notes) body.notes = opts.notes;
    if (opts.startDate) body.start_date = opts.startDate;
    if (opts.endDate) body.end_date = opts.endDate;

    const node = (await api.patch(`/api/nodes/${id}`, body)) as Node;

    if (opts.json) {
      console.log(JSON.stringify(node, null, 2));
      return;
    }

    console.log(`Updated node ${node.id}`);
    printNode(node);
  });

nodeCommand
  .command("delete <id>")
  .description("Delete a node")
  .action(async (id) => {
    await api.delete(`/api/nodes/${id}`);
    console.log(`Deleted node ${id}`);
  });
