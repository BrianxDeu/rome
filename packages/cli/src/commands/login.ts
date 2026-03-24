import { Command } from "commander";
import { api } from "../api.js";
import { saveConfig } from "../config.js";
import type { AuthResponse } from "@rome/shared/types";

export const loginCommand = new Command("login")
  .description("Authenticate with the Rome server")
  .requiredOption("-u, --username <username>", "Username")
  .requiredOption("-p, --password <password>", "Password")
  .option("-s, --server <url>", "Server URL")
  .action(async (opts) => {
    if (opts.server) {
      saveConfig({ server: opts.server });
    }

    const res = (await api.post("/api/auth/login", {
      username: opts.username,
      password: opts.password,
    })) as AuthResponse;

    saveConfig({ token: res.token });
    console.log(`Logged in as ${res.user.username} (${res.user.role})`);
  });
