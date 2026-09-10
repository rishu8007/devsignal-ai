import { AuthPageShell } from "@/components/auth/auth-page-shell";
import { LoginForm } from "@/components/auth/login-form";

interface LoginPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams;
  const registrationSucceeded = params.registered === "1";
  return (
    <AuthPageShell title="Welcome back" description="Sign in to continue shaping your next useful insight.">
      <LoginForm registrationSucceeded={registrationSucceeded} />
    </AuthPageShell>
  );
}
