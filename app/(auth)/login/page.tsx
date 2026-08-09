import { AuthForm } from "../auth-form";
import { login } from "../actions";

export default function LoginPage() {
  return (
    <AuthForm
      title="Log in to VendorPulse"
      submitLabel="Log in"
      action={login}
      altPrompt="No account yet?"
      altHref="/signup"
      altLabel="Sign up"
    />
  );
}
