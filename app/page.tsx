import { redirect } from "next/navigation";

export default function Home() {
  // Signed-in users see the dashboard. Middleware sends signed-out users to
  // /login.
  redirect("/dashboard");
}
