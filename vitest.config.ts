import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@shared": path.resolve(import.meta.dirname, "shared"),
      "@": path.resolve(import.meta.dirname, "client/src"),
    },
  },
  test: {
    environment: "node",
    // client/src/lib holds pure logic (no DOM), so it runs in the node env too.
    include: ["server/**/*.test.ts", "shared/**/*.test.ts", "client/src/lib/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["server/**/*.ts", "shared/**/*.ts", "client/src/lib/**/*.ts"],
    },
  },
});
