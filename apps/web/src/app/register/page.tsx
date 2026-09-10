import { AuthPageShell } from "@/components/auth/auth-page-shell";
import { RegisterForm } from "@/components/auth/register-form";

export default function RegisterPage() {
  return (
    <AuthPageShell title="Create your account" description="Turn your real technical work into credible signals.">
      <RegisterForm />
    </AuthPageShell>
  );
}
