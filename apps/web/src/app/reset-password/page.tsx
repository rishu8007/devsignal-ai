import Link from "next/link";
import { AuthPageShell } from "@/components/auth/auth-page-shell";

export const metadata = { referrer: "no-referrer" as const };

export default function ResetPasswordPage() {
  return (
    <AuthPageShell
      title="Password reset unavailable"
      description="Password reset is temporarily unavailable."
    >
      <p className="mt-8 text-center text-sm text-slate-400">
        <Link className="text-cyan-300 hover:text-cyan-200" href="/login">
          Back to sign in
        </Link>
      </p>
    </AuthPageShell>
  );
}
