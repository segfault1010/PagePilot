import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    pool: "forks",
    fileParallelism: false,
    testTimeout: 20000,
    hookTimeout: 20000,
    teardownTimeout: 20000,
  },
});
