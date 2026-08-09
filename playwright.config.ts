import { defineConfig, devices } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Load .env.local into the test process. Next loads it for the app, but the
// Playwright runner is a separate Node process and needs it too (the API-level
// RLS tests talk to Supabase directly). Resolved from the working directory,
// which is the project root when running via npm/npx.
try {
  const raw = readFileSync(resolve(process.cwd(), ".env.local"), "utf8");
  for (const line of raw.split("\n")) {
    const match = line.match(/^\s*([\w.]+)\s*=\s*(.*)\s*$/);
    if (match && process.env[match[1]] === undefined) {
      process.env[match[1]] = match[2].trim();
    }
  }
} catch {
  // No .env.local — tests that need Supabase will fail with a clear message.
}

const PORT = 3000;
const baseURL = `http://localhost:${PORT}`;

/**
 * Playwright config for VendorPulse e2e tests.
 *
 * The tests need a running app and a reachable Supabase project. Turn OFF
 * "Confirm email" in Supabase so sign-up creates a session at once.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: "list",
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "npm run dev",
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
