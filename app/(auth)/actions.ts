"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type AuthState = { error: string } | null;

/** Shape returned by an auth form via useActionState. */
function readCredentials(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  return { email, password };
}

export async function login(
  _prevState: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const { email, password } = readCredentials(formData);

  if (!email || !password) {
    return { error: "Enter your email and password." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    // Return the error so the form shows it inline. Do not redirect.
    return { error: "Wrong email or password. Try again." };
  }

  redirect("/vendors");
}

export async function signup(
  _prevState: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const { email, password } = readCredentials(formData);

  if (!email || !password) {
    return { error: "Enter your email and password." };
  }
  if (password.length < 6) {
    return { error: "Use a password with 6 characters or more." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signUp({ email, password });

  if (error) {
    return { error: error.message };
  }

  redirect("/vendors");
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
