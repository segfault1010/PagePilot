/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  test: {
    environment: "node",
    // Threads instead of the default forks pool, pinned to a single worker:
    // worker spawns are slow and flaky under Windows AV scanning on this
    // machine, and the suite is small enough to run sequentially.
    pool: "threads",
    maxWorkers: 1,
    include: ["tests/**/*.test.{ts,tsx}"],
  },
});
