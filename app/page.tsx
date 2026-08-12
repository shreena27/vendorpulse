import { redirect } from "next/navigation";

export default function Home() {
  // Signed-in users see their vendor list, the real product home. Middleware
  // sends signed-out users to /login.
  redirect("/vendors");
}
