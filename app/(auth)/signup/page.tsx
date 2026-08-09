import { AuthForm } from "../auth-form";
import { signup } from "../actions";

export default function SignupPage() {
  return (
    <AuthForm
      title="Create your VendorPulse account"
      submitLabel="Sign up"
      action={signup}
      altPrompt="Already have an account?"
      altHref="/login"
      altLabel="Log in"
    />
  );
}
