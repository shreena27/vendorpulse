import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./types";

/**
 * Supabase client with the SERVICE ROLE key. SERVER-ONLY.
 *
 * It bypasses Row Level Security by design, so the cron pollers can read and
 * write across every organization on a schedule (ERD §6.1). NEVER import this
 * into a client component or expose the service-role key to the browser.
 *
 * No session is persisted — this client is not tied to a signed-in user.
 */
export function createAdminClient() {
  return createSupabaseClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}
