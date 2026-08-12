import { test, expect, type Page } from "@playwright/test";

/**
 * Chunk 1.1 acceptance: vendor bulk import.
 *
 * 1. A good file imports every row and the vendors appear in the list.
 * 2. A file with a duplicate GSTIN skips and reports the duplicate; the vendor
 *    is listed once, never double-counted or merged.
 * 3. An empty file shows a clear error, not a blank success state.
 *
 * Prerequisite: migrations 0001 + 0002 are applied, and Supabase "Confirm
 * email" is OFF so sign-up creates a session at once.
 */

const PASSWORD = "test-password-123";

function uniqueEmail(tag: string) {
  const stamp = Date.now();
  const rand = Math.random().toString(36).slice(2, 8);
  return `vendorpulse.import.${tag}.${stamp}.${rand}@gmail.com`;
}

/** Sign up through the UI; lands on /vendors with a live session. */
async function signUp(page: Page, tag: string) {
  const email = uniqueEmail(tag);
  await page.goto("/signup");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign up" }).click();
  await expect(page).toHaveURL(/\/vendors$/);
  return email;
}

/** A valid 15-char GSTIN for the given 2-digit state code and serial. */
function gstin(state: string, serial: number) {
  const pan = `ABCDE${String(serial).padStart(4, "0")}F`;
  return `${state}${pan}1Z5`;
}

/** Build a CSV file as a Playwright upload payload. */
function csvFile(name: string, content: string) {
  return { name, mimeType: "text/csv", buffer: Buffer.from(content, "utf8") };
}

/** Pick a file on the import page and wait for the mapping UI to appear. */
async function chooseFile(
  page: Page,
  file: { name: string; mimeType: string; buffer: Buffer },
) {
  await page.goto("/vendors/import");
  await page.getByLabel("Choose a file").setInputFiles(file);
}

test("good file imports every row and lists the vendors", async ({ page }) => {
  await signUp(page, "good");

  const rows = [
    "Vendor Name,GSTIN,Udyam",
    `Alpha Supplies,${gstin("27", 1)},UDYAM-MH-01-0000001`,
    `Bravo Traders,${gstin("29", 2)},`,
    `Charlie Corp,${gstin("07", 3)},UDYAM-DL-02-0000003`,
  ].join("\n");

  await chooseFile(page, csvFile("vendors.csv", rows));

  // Mapping auto-guesses from the headers.
  await expect(page.getByLabel("Column for Vendor name")).toHaveValue(
    "Vendor Name",
  );
  await expect(page.getByLabel("Column for GSTIN")).toHaveValue("GSTIN");

  await page.getByRole("button", { name: "Import vendors" }).click();

  await expect(
    page.getByRole("heading", { name: "Imported 3 of 3 vendors" }),
  ).toBeVisible();

  // Every vendor is listed.
  await page.goto("/vendors");
  await expect(page.getByText("Showing 3 of 3 vendors")).toBeVisible();
  await expect(page.getByText("Alpha Supplies")).toBeVisible();
  await expect(page.getByText("Bravo Traders")).toBeVisible();
  await expect(page.getByText("Charlie Corp")).toBeVisible();
});

test("duplicate GSTIN is skipped and reported, not double-counted", async ({
  page,
}) => {
  await signUp(page, "dupe");

  const shared = gstin("27", 10);
  const rows = [
    "Vendor Name,GSTIN",
    `Delta First,${shared}`,
    `Delta Duplicate,${shared}`,
    `Echo Unique,${gstin("29", 11)}`,
  ].join("\n");

  await chooseFile(page, csvFile("dupes.csv", rows));
  await page.getByRole("button", { name: "Import vendors" }).click();

  // Three data rows, one skipped -> two inserted.
  await expect(
    page.getByRole("heading", { name: "Imported 2 of 3 vendors" }),
  ).toBeVisible();

  // The duplicate is reported by row number (file line 3), as a GSTIN issue.
  const skipped = page.getByText(/Row 3 — gstin:.*Duplicate/i);
  await expect(skipped).toBeVisible();

  // The shared GSTIN exists exactly once in the list — not merged, not doubled.
  await page.goto("/vendors");
  await expect(page.getByText(shared)).toHaveCount(1);
  await expect(page.getByText("Showing 2 of 2 vendors")).toBeVisible();
});

test("empty file shows a clear error, not a blank success", async ({ page }) => {
  await signUp(page, "empty");

  // Headers only, zero data rows: the page catches this before any upload.
  await chooseFile(page, csvFile("empty.csv", "Vendor Name,GSTIN"));

  await expect(
    page.getByRole("alert").filter({ hasText: /no rows/i }),
  ).toBeVisible();

  // No success report appears.
  await expect(page.getByRole("heading", { name: /Imported/ })).toHaveCount(0);

  // And nothing was created.
  await page.goto("/vendors");
  await expect(page.getByText(/No vendors yet/i)).toBeVisible();
});
