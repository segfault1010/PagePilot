import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    pool: "forks",
    testTimeout: 20000,
    hookTimeout: 20000,
    teardownTimeout: 20000,
  },
});
