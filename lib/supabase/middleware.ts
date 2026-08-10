import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/** Paths a signed-out user is allowed to reach. */
const PUBLIC_PATHS = ["/login", "/signup"];

/**
 * Refresh the auth session on every request and guard protected routes.
 *
 * This helper does two jobs:
 * 1. It refreshes the Supabase session cookie so it never expires mid-session.
 * 2. It redirects a signed-out user to `/login` when they request a protected
 *    path.
 */
export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // IMPORTANT: Do not run any code between createServerClient and getUser().
  // A missed refresh here can log users out at random.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  const isPublic = PUBLIC_PATHS.some(
    (p) => path === p || path.startsWith(`${p}/`),
  );
  // API routes enforce their own auth and must return JSON status codes, never
  // an HTML redirect to /login. The session cookie was still refreshed above;
  // we only skip the redirect. (e.g. /api/vendors/import returns 401; the cron
  // routes return 401 unless the Bearer CRON_SECRET matches.)
  const isApi = path.startsWith("/api/");

  if (!user && !isPublic && !isApi) {
    // No session and the path is protected. Send the user to login.
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  // IMPORTANT: Return supabaseResponse as-is to keep cookies in sync.
  return supabaseResponse;
}
