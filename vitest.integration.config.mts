import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Repo root (no trailing slash) so the `@/*` alias resolves like it does in Next.
const root = fileURLToPath(new URL(".", import.meta.url)).replace(/[\\/]$/, "");

// Integration tests that hit a real Supabase project. Run via
// `npm run test:integration`; kept out of the default `npm test`. The test
// itself loads .env.local and self-skips when the Supabase env is absent.
export default defineConfig({
  resolve: {
    alias: [{ find: /^@\/(.*)$/, replacement: `${root}/$1` }],
  },
  test: {
    environment: "node",
    include: ["lib/**/*.integration.test.ts"],
    testTimeout: 30_000,
    fileParallelism: false,
  },
});
