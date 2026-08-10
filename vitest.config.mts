import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Repo root (no trailing slash), so the `@/*` import alias from tsconfig.json
// resolves the same way under Vitest as it does under Next.
const root = fileURLToPath(new URL(".", import.meta.url)).replace(/[\\/]$/, "");

// Unit tests for server-side libraries (e.g. the provider adapters).
// The browser end-to-end tests run under Playwright (`npm run test:e2e`) and
// live in `e2e/` — excluded here so the two runners never collide.
export default defineConfig({
  resolve: {
    alias: [{ find: /^@\/(.*)$/, replacement: `${root}/$1` }],
  },
  test: {
    environment: "node",
    include: ["lib/**/*.test.ts"],
    exclude: ["e2e/**", "node_modules/**", ".next/**"],
  },
});
