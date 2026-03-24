import { Command } from "commander";
import { api } from "../api.js";
import type { Node, Edge } from "@rome/shared/types";

interface GraphResponse {
  nodes: Node[];
  edges: Edge[];
}

export const graphCommand = new Command("graph")
  .description("Fetch the full project graph")
  .option("--json", "Output as JSON")
  .action(async (opts) => {
    const graph = (await api.get("/api/graph")) as GraphResponse;

    if (opts.json) {
      console.log(JSON.stringify(graph, null, 2));
      return;
    }

    console.log(`Nodes: ${graph.nodes.length}`);
    console.log(`Edges: ${graph.edges.length}`);
    console.log();

    if (graph.nodes.length > 0) {
      console.log("Nodes:");
      for (const node of graph.nodes) {
        const parts = [
          `  ${node.id.slice(0, 8)}`,
          node.status.padEnd(12),
          node.priority,
          node.name,
        ];
        if (node.workstream) parts.push(`[${node.workstream}]`);
        console.log(parts.join("  "));
      }
    }

    if (graph.edges.length > 0) {
      console.log("\nEdges:");
      for (const edge of graph.edges) {
        console.log(
          `  ${edge.id.slice(0, 8)}  ${edge.type.padEnd(10)}  ${edge.sourceId.slice(0, 8)} -> ${edge.targetId.slice(0, 8)}`,
        );
      }
    }
  });
