import { test, expect } from "@playwright/test";

/**
 * Chunk 0.1 acceptance: sign up -> dashboard -> log out -> log in, plus the
 * two failure paths (protected route redirect, wrong password inline error).
 *
 * Prerequisite: Supabase "Confirm email" is OFF, so sign-up creates a session
 * immediately.
 */

/**
 * Make a unique email for each test run so sign-up always succeeds.
 * Use a domain with real mail records. Supabase rejects `@example.com` as
 * invalid. No mail is sent because "Confirm email" is off.
 */
function uniqueEmail() {
  const stamp = Date.now();
  const rand = Math.random().toString(36).slice(2, 8);
  return `vendorpulse.e2e.${stamp}.${rand}@gmail.com`;
}

const PASSWORD = "test-password-123";

test("sign up, log out, and log back in", async ({ page }) => {
  const email = uniqueEmail();

  // Sign up -> lands on the dashboard shell.
  await page.goto("/signup");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign up" }).click();

  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole("button", { name: "Log out" })).toBeVisible();
  await expect(page.getByText(email).first()).toBeVisible();

  // Log out -> back to the login page.
  await page.getByRole("button", { name: "Log out" }).click();
  await expect(page).toHaveURL(/\/login$/);

  // Log back in with the same credentials -> dashboard again.
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Log in" }).click();

  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole("button", { name: "Log out" })).toBeVisible();
});

test("unauthenticated dashboard access redirects to login", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login$/);
});

test("wrong password shows an inline error, not a redirect loop", async ({
  page,
}) => {
  const email = uniqueEmail();

  // Create the account first.
  await page.goto("/signup");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign up" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);

  // Log out, then try the wrong password.
  await page.getByRole("button", { name: "Log out" }).click();
  await expect(page).toHaveURL(/\/login$/);

  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("wrong-password");
  await page.getByRole("button", { name: "Log in" }).click();

  // Stays on /login and shows the inline error.
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("alert")).toBeVisible();
});
