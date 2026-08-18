import { defineConfig } from "vitest/config";
import { loadEnv } from "vite";
import path from "node:path";

// -------------------------------------------------------------------
// Vitest config - unit tests (schemas, validation, business logic)
// -------------------------------------------------------------------
export default defineConfig(({ mode }) => ({
  resolve: {
    // Mirror the "@/* -> src/*" path alias from tsconfig.json
    alias: {
      "@": path.resolve(process.cwd(), "src"),
      // `import "server-only"` has no resolvable module outside a bundler,
      // so without this every service and repository is untestable. See the
      // note in the stub.
      "server-only": path.resolve(process.cwd(), "src/lib/test/server-only-stub.ts"),
    },
  },
  test: {
    environment: "node",
    // Load .env so modules that validate env at import time (e.g. env-client) work
    env: loadEnv(mode, process.cwd(), ""),
    include: ["src/**/*.test.ts"],
  },
}));
