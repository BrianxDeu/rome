import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": `http://localhost:${process.env.API_PORT || "3000"}`,
      "/ws": {
        target: `ws://localhost:${process.env.API_PORT || "3000"}`,
        ws: true,
      },
    },
  },
});
