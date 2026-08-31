/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  envDir: path.resolve(__dirname, "../../"),
  plugins: [react(), tailwindcss()],
  test: {
    environment: "node",
    pool: "threads",
    maxWorkers: 1,
    include: ["tests/**/*.test.{ts,tsx}"],
  },
});
