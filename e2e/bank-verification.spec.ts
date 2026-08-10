import { test, expect, type Page } from "@playwright/test";
import {
  MOCK_ACCOUNT_EXACT_MATCH,
  MOCK_ACCOUNT_PARTIAL_MATCH,
  MOCK_IFSC,
} from "../lib/providers/bank/mockAdapter";

/**
 * Chunk 2.1 acceptance: bank account verification runs automatically right
 * after import. A vendor whose bank details only partially match its
 * registered name must show "Manual review" — never a false "Verified".
 *
 * Prerequisite: migration 0004 applied and Supabase "Confirm email" off.
 * Uses BANK_PROVIDER=mock (the default — no live Eko credentials exist).
 */

const PASSWORD = "test-password-123";

function uniqueEmail(tag: string) {
  const stamp = Date.now();
  const rand = Math.random().toString(36).slice(2, 8);
  return `vendorpulse.bank.${tag}.${stamp}.${rand}@gmail.com`;
}

async function signUp(page: Page, tag: string) {
  const email = uniqueEmail(tag);
  await page.goto("/signup");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign up" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  return email;
}

function csvFile(name: string, content: string) {
  return { name, mimeType: "text/csv", buffer: Buffer.from(content, "utf8") };
}

test("a vendor whose bank name only partially matches shows Manual review, not Verified", async ({
  page,
}) => {
  await signUp(page, "mismatch");

  const rows = [
    "Vendor Name,Bank Account Number,IFSC",
    // The mock's exact-match fixture always echoes the vendor's own name back
    // as the account holder, so this row is unambiguously "verified". Named
    // to avoid containing any badge-label word itself (e.g. "Verified"),
    // which would collide with the badge text in a substring-text locator.
    `Alpha Trading Co,${MOCK_ACCOUNT_EXACT_MATCH},${MOCK_IFSC}`,
    // The partial-match fixture derives a holder name that shares only the
    // vendor's first word — a real mismatch a finance head must review.
    `Beta Commerce Ltd,${MOCK_ACCOUNT_PARTIAL_MATCH},${MOCK_IFSC}`,
  ].join("\n");

  await page.goto("/vendors/import");
  await page.getByLabel("Choose a file").setInputFiles(csvFile("bank.csv", rows));

  // The new bank columns auto-map from their headers.
  await expect(page.getByLabel("Column for Bank account number")).toHaveValue(
    "Bank Account Number",
  );
  await expect(page.getByLabel("Column for IFSC")).toHaveValue("IFSC");

  await page.getByRole("button", { name: "Import vendors" }).click();

  await expect(
    page.getByRole("heading", { name: "Imported 2 of 2 vendors" }),
  ).toBeVisible();
  await expect(page.getByText(/1 verified/)).toBeVisible();
  await expect(page.getByText(/1 need manual review/)).toBeVisible();

  await page.goto("/vendors");

  const alpha = page.getByRole("row", { name: /Alpha Trading Co/ });
  await expect(alpha.getByText("Verified", { exact: true })).toBeVisible();

  const beta = page.getByRole("row", { name: /Beta Commerce Ltd/ });
  await expect(beta.getByText("Manual review", { exact: true })).toBeVisible();
  await expect(beta.getByText("Verified", { exact: true })).toHaveCount(0);
});
