import { Command } from "commander";
import { api } from "../api.js";

interface BudgetNode {
  id: string;
  name: string;
  own: number;
  rollup: number;
}

interface WorkstreamBudget {
  workstream: string;
  total: number;
  nodes: BudgetNode[];
}

interface BudgetResponse {
  workstreams: WorkstreamBudget[];
}

export const budgetCommand = new Command("budget")
  .description("View budget rollup by workstream")
  .option("--json", "Output as JSON")
  .action(async (opts) => {
    const budget = (await api.get("/api/budget")) as BudgetResponse;

    if (opts.json) {
      console.log(JSON.stringify(budget, null, 2));
      return;
    }

    if (budget.workstreams.length === 0) {
      console.log("No budget data.");
      return;
    }

    for (const ws of budget.workstreams) {
      console.log(`${ws.workstream}: ${ws.total}`);
      for (const node of ws.nodes) {
        const rollupNote =
          node.rollup !== node.own ? ` (rollup: ${node.rollup})` : "";
        console.log(`  ${node.id.slice(0, 8)}  ${node.name}  ${node.own}${rollupNote}`);
      }
    }
  });
