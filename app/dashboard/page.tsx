import { redirect } from "next/navigation";

// /vendors is the real product home now — this route only exists so a stale
// bookmark/link still lands somewhere useful instead of 404ing. Middleware
// already sends signed-out users to /login for any protected route,
// including this one, before this component ever runs.
export default function DashboardPage() {
  redirect("/vendors");
}
