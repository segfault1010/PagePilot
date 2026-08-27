import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    pool: "forks",
    maxWorkers: 2,
    testTimeout: 20000,
    hookTimeout: 20000,
    teardownTimeout: 20000,
  },
});
