import { Command } from "commander";
import { api } from "../api.js";

interface EdgeResponse {
  id: string;
  source_id: string;
  target_id: string;
  type: string;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export const edgeCommand = new Command("edge").description(
  "Manage node edges (dependencies and hierarchy)",
);

edgeCommand
  .command("create")
  .description("Create an edge between two nodes")
  .requiredOption("--source <id>", "Source node ID")
  .requiredOption("--target <id>", "Target node ID")
  .requiredOption("--type <type>", "Edge type (blocks|parent_of)")
  .option("--json", "Output as JSON")
  .action(async (opts) => {
    const edge = (await api.post("/api/edges", {
      source_id: opts.source,
      target_id: opts.target,
      type: opts.type,
    })) as EdgeResponse;

    if (opts.json) {
      console.log(JSON.stringify(edge, null, 2));
      return;
    }

    console.log(`Created edge ${edge.id} (${edge.type}: ${edge.source_id} -> ${edge.target_id})`);
  });

edgeCommand
  .command("delete <id>")
  .description("Delete an edge")
  .action(async (id) => {
    await api.delete(`/api/edges/${id}`);
    console.log(`Deleted edge ${id}`);
  });
