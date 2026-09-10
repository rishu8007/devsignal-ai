"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { ApiClientError } from "@/lib/api/auth-client";
import { useAuth } from "@/components/auth/auth-provider";
import {
  applyFieldErrors,
  validateLoginForm,
  type LoginField,
  type LoginFieldErrors,
  type LoginFormValues,
} from "@/lib/validation/auth";

export function LoginForm({ registrationSucceeded }: { registrationSucceeded: boolean }) {
  const router = useRouter();
  const { status, login } = useAuth();
  const [values, setValues] = useState<LoginFormValues>({ email: "", password: "" });
  const [touched, setTouched] = useState<Partial<Record<LoginField, boolean>>>({});
  const [submitted, setSubmitted] = useState(false);
  const [serverMessage, setServerMessage] = useState("");
  const [backendErrors, setBackendErrors] = useState<LoginFieldErrors>({});
  const [pending, setPending] = useState(false);
  const errors = validateLoginForm(values);
  const visibleErrors = {
    ...(submitted ? errors : Object.fromEntries(
      Object.entries(errors).filter(([field]) => touched[field as LoginField]),
    ) as LoginFieldErrors),
    ...backendErrors,
  };

  useEffect(() => {
    if (status === "authenticated") router.replace("/dashboard");
  }, [router, status]);

  if (status === "authenticated") {
    return <p className="mt-8 text-sm text-slate-300">Opening your workspace...</p>;
  }
  if (status === "loading") return <p className="mt-8 text-sm text-slate-300">Checking your session...</p>;

  function update(field: LoginField, value: string) {
    setValues((current) => ({ ...current, [field]: value }));
    setBackendErrors((current) => ({ ...current, [field]: undefined }));
    setServerMessage("");
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitted(true);
    setTouched({ email: true, password: true });
    if (Object.keys(errors).length > 0) return;
    setPending(true);
    setServerMessage("");
    setBackendErrors({});
    try {
      await login(values.email.trim().toLowerCase(), values.password);
      router.replace("/dashboard");
    } catch (error: unknown) {
      if (error instanceof ApiClientError && error.code === "VALIDATION_ERROR") {
        setBackendErrors(applyFieldErrors<LoginField>(error.details, ["email", "password"]));
        setTouched({ email: true, password: true });
        setServerMessage("Please review the highlighted fields.");
      } else if (error instanceof ApiClientError && error.code === "LOGIN_RATE_LIMIT_EXCEEDED") {
        setServerMessage("Too many login attempts. Please try again later.");
      } else if (error instanceof ApiClientError && error.code === "INVALID_CREDENTIALS") {
        setServerMessage("Invalid email or password");
      } else {
        setServerMessage("Unable to sign in right now. Please try again.");
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="mt-8 space-y-5" onSubmit={submit} noValidate>
      {registrationSucceeded && <p className="rounded-lg bg-teal-300/10 p-3 text-sm text-teal-200" aria-live="polite">Account created. You can sign in now.</p>}
      <AuthInput id="login-email" label="Email" type="email" autoComplete="email" value={values.email} error={visibleErrors.email} onChange={(value) => update("email", value)} onBlur={() => setTouched((current) => ({ ...current, email: true }))} />
      <AuthInput id="login-password" label="Password" type="password" autoComplete="current-password" value={values.password} error={visibleErrors.password} onChange={(value) => update("password", value)} onBlur={() => setTouched((current) => ({ ...current, password: true }))} />
      <p className="min-h-6 text-sm text-red-300" aria-live="polite">{serverMessage}</p>
      <button type="submit" disabled={pending || Object.keys(errors).length > 0} className="w-full rounded-lg bg-cyan-300 px-4 py-3 text-sm font-semibold text-slate-950 disabled:cursor-not-allowed disabled:opacity-50">{pending ? "Signing in..." : "Sign in"}</button>
      <p className="text-center text-sm text-slate-400">Need an account? <Link className="text-cyan-300 hover:text-cyan-200" href="/register">Create one</Link></p>
    </form>
  );
}

interface AuthInputProps {
  id: string;
  label: string;
  type: "email" | "password";
  autoComplete: string;
  value: string;
  error?: string;
  onChange: (value: string) => void;
  onBlur: () => void;
}

function AuthInput({ id, label, type, autoComplete, value, error, onChange, onBlur }: AuthInputProps) {
  const errorId = `${id}-error`;
  return (
    <div>
      <label htmlFor={id} className="mb-2 block text-sm font-medium text-slate-200">{label}</label>
      <input id={id} type={type} autoComplete={autoComplete} value={value} onChange={(event) => onChange(event.target.value)} onBlur={onBlur} aria-invalid={Boolean(error)} aria-describedby={error ? errorId : undefined} className="w-full rounded-lg border border-white/10 bg-slate-950 px-3.5 py-3 text-sm text-white outline-none focus:border-cyan-300" />
      {error && <p id={errorId} className="mt-2 text-sm text-red-300">{error}</p>}
    </div>
  );
}
