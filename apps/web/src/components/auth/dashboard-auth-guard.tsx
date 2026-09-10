"use client";

import { useAuth } from "@/components/auth/auth-provider";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import type { ReactNode } from "react";

export function DashboardAuthGuard({ children }: { children: ReactNode }) {
  const { status, errorMessage, retry } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (status === "unauthenticated") router.replace("/login");
  }, [router, status]);

  if (status === "loading") {
    return <LoadingState message="Restoring your session..." />;
  }
  if (status === "error") {
    return (
      <LoadingState
        message={errorMessage ?? "Your session is temporarily unavailable."}
        action={<button type="button" onClick={() => void retry()} className="mt-4 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white">Try again</button>}
      />
    );
  }
  if (status !== "authenticated") return null;
  return <>{children}</>;
}

function LoadingState({ message, action }: { message: string; action?: ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-950 px-6 text-center text-slate-100">
      <div role="status">
        <p className="text-sm text-slate-300">{message}</p>
        {action}
      </div>
    </main>
  );
}
