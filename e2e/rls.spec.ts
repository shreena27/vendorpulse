import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../lib/supabase/types";

/**
 * Chunk 0.2 acceptance: multi-tenant isolation.
 *
 * 1. A signed-up user is auto-assigned to an organization row.
 * 2. One org's user can never SELECT another org's rows — checked directly
 *    against Postgres (via PostgREST with the user's own JWT), and in the UI.
 *
 * Prerequisite: migration 0001_core.sql is applied and "Confirm email" is off.
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const PASSWORD = "test-password-123";

function uniqueEmail(tag: string) {
  const stamp = Date.now();
  const rand = Math.random().toString(36).slice(2, 8);
  return `vendorpulse.rls.${tag}.${stamp}.${rand}@gmail.com`;
}

/** A fresh Supabase JS client (isolated session per caller). */
function freshClient() {
  return createClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Sign up a user and return an authenticated client plus their email. */
async function signUpUser(tag: string) {
  const email = uniqueEmail(tag);
  const supabase = freshClient();
  const { data, error } = await supabase.auth.signUp({ email, password: PASSWORD });
  expect(error, `sign-up for ${tag} should succeed`).toBeNull();
  expect(data.session, `sign-up for ${tag} should return a session`).not.toBeNull();
  return { supabase, email };
}

test("sign-up auto-provisions exactly one organization and one user row", async () => {
  const { supabase, email } = await signUpUser("solo");

  const { data: orgs, error: orgErr } = await supabase
    .from("organizations")
    .select("id, name");
  expect(orgErr).toBeNull();
  expect(orgs).toHaveLength(1);
  expect(orgs![0].name).toBe(email); // default org name is the sign-up email

  const { data: members, error: userErr } = await supabase
    .from("users")
    .select("email, role");
  expect(userErr).toBeNull();
  expect(members).toHaveLength(1);
  expect(members![0].email).toBe(email);
  expect(members![0].role).toBe("admin");
});

test("RLS blocks cross-tenant SELECT on organizations and users", async () => {
  const a = await signUpUser("a");
  const b = await signUpUser("b");

  const { data: orgsA } = await a.supabase.from("organizations").select("id");
  const { data: orgsB } = await b.supabase.from("organizations").select("id");
  const orgAId = orgsA![0].id;
  const orgBId = orgsB![0].id;
  expect(orgAId).not.toBe(orgBId);

  // A explicitly asks for B's org by id -> RLS returns zero rows, not an error.
  const { data: aSeesOrgB } = await a.supabase
    .from("organizations")
    .select("id")
    .eq("id", orgBId);
  expect(aSeesOrgB).toHaveLength(0);

  // A asks for any user that is not A -> zero rows (cannot see B's user row).
  const { data: aSeesOtherUsers } = await a.supabase
    .from("users")
    .select("email")
    .neq("email", a.email);
  expect(aSeesOtherUsers).toHaveLength(0);

  // Symmetric check from B's side.
  const { data: bSeesOrgA } = await b.supabase
    .from("organizations")
    .select("id")
    .eq("id", orgAId);
  expect(bSeesOrgA).toHaveLength(0);
});

test("dashboard shows only the signed-in user's own org and member", async ({
  browser,
}) => {
  // Two users in two different orgs, each in an isolated browser context.
  const emailA = uniqueEmail("ui-a");
  const emailB = uniqueEmail("ui-b");

  async function signUpInUi(email: string) {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto("/signup");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Sign up" }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
    return { context, page };
  }

  const a = await signUpInUi(emailA);
  const b = await signUpInUi(emailB);

  // A's dashboard shows A's org name and A's email, never B's.
  await expect(a.page.getByRole("heading", { name: emailA })).toBeVisible();
  await expect(a.page.getByText(emailA).first()).toBeVisible();
  await expect(a.page.getByText(emailB)).toHaveCount(0);

  // B's dashboard shows B's data, never A's.
  await expect(b.page.getByRole("heading", { name: emailB })).toBeVisible();
  await expect(b.page.getByText(emailB).first()).toBeVisible();
  await expect(b.page.getByText(emailA)).toHaveCount(0);

  await a.context.close();
  await b.context.close();
});
