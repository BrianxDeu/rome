#!/usr/bin/env node
import { Command } from "commander";
import { loginCommand } from "./commands/login.js";
import { nodeCommand } from "./commands/node.js";
import { edgeCommand } from "./commands/edge.js";
import { graphCommand } from "./commands/graph.js";
import { budgetCommand } from "./commands/budget.js";
import { ApiError } from "./api.js";

const program = new Command();

program
  .name("rome")
  .description("Rome project management CLI")
  .version("0.0.1");

program.addCommand(loginCommand);
program.addCommand(nodeCommand);
program.addCommand(edgeCommand);
program.addCommand(graphCommand);
program.addCommand(budgetCommand);

program.parseAsync().catch((err: unknown) => {
  if (err instanceof ApiError) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }
  throw err;
});
