import { test, expect, type Page } from "@playwright/test";

/**
 * PRD §8 story 1 — Connect vendor list. A finance head uploads their vendor
 * list once and every vendor is connected. A corrupt file must be rejected
 * with a clear error — never a silent partial/blank "success."
 *
 * Prerequisite: migrations 0001-0002 applied, Supabase "Confirm email" off.
 */

const PASSWORD = "test-password-123";

function uniqueEmail(tag: string) {
  const stamp = Date.now();
  const rand = Math.random().toString(36).slice(2, 8);
  return `vendorpulse.flow1.${tag}.${stamp}.${rand}@gmail.com`;
}

async function signUp(page: Page, tag: string) {
  const email = uniqueEmail(tag);
  await page.goto("/signup");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign up" }).click();
  await expect(page).toHaveURL(/\/vendors$/);
  return email;
}

function gstin(state: string, serial: number) {
  const pan = `ABCDE${String(serial).padStart(4, "0")}F`;
  return `${state}${pan}1Z5`;
}

function csvFile(name: string, content: string) {
  return { name, mimeType: "text/csv", buffer: Buffer.from(content, "utf8") };
}

test("a finance head uploads a vendor list and every vendor is connected", async ({ page }) => {
  await signUp(page, "good");

  const rows = [
    "Vendor Name,GSTIN,Udyam",
    `Flow One Alpha,${gstin("27", 41)},UDYAM-MH-01-0000041`,
    `Flow One Bravo,${gstin("29", 42)},UDYAM-KA-01-0000042`,
  ].join("\n");

  await page.goto("/vendors/import");
  await page.getByLabel("Choose a file").setInputFiles(csvFile("vendors.csv", rows));
  await expect(page.getByLabel("Column for Vendor name")).toHaveValue("Vendor Name");
  await page.getByRole("button", { name: "Import vendors" }).click();

  await expect(
    page.getByRole("heading", { name: "Imported 2 of 2 vendors" }),
  ).toBeVisible();

  await page.goto("/vendors");
  await expect(page.getByText("Showing 2 of 2 vendors")).toBeVisible();
  await expect(page.getByText("Flow One Alpha")).toBeVisible();
  await expect(page.getByText("Flow One Bravo")).toBeVisible();
});

test("a corrupt file is rejected with a clear error, never a silent partial success", async ({ page }) => {
  await signUp(page, "corrupt");

  // A ZIP local-file-header signature (the first four bytes of every real
  // .xlsx) followed by random-looking bytes that don't form a valid
  // archive. This forces SheetJS into its OOXML zip-reading path (rather
  // than falling back to a lenient plain-text/CSV interpretation, which
  // would NOT throw), and the zip reader then fails to find a valid
  // end-of-central-directory record and throws — parseVendorFile.ts's
  // try/catch in app/vendors/import/page.tsx's handleFile() converts that
  // into the "Could not read this file" alert asserted below. If a future
  // SheetJS version tolerates this exact byte pattern, enlarge the random
  // tail (e.g. to 2KB) until the parse error reliably reproduces.
  const corrupt = Buffer.concat([
    Buffer.from([0x50, 0x4b, 0x03, 0x04]),
    Buffer.from(Array.from({ length: 256 }, (_, i) => (i * 37 + 11) % 256)),
  ]);

  await page.goto("/vendors/import");
  await page.getByLabel("Choose a file").setInputFiles({
    name: "corrupt.xlsx",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: corrupt,
  });

  await expect(
    page.getByRole("alert").filter({ hasText: /could not read this file/i }),
  ).toBeVisible();

  // The mapping/import step never appears — nothing to submit.
  await expect(page.getByRole("button", { name: "Import vendors" })).toHaveCount(0);

  await page.goto("/vendors");
  await expect(page.getByText(/No vendors yet/i)).toBeVisible();
});
