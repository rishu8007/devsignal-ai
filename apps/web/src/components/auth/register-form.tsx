"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { ApiClientError, registerUser } from "@/lib/api/auth-client";
import { useAuth } from "@/components/auth/auth-provider";
import { applyFieldErrors, validateRegisterForm, type AuthField, type RegisterFormValues } from "@/lib/validation/auth";

export function RegisterForm() {
  const router = useRouter();
  const { status } = useAuth();
  const [values, setValues] = useState<RegisterFormValues>({ name: "", email: "", password: "", confirmPassword: "" });
  const [touched, setTouched] = useState<Partial<Record<AuthField, boolean>>>({});
  const [submitted, setSubmitted] = useState(false);
  const [serverMessage, setServerMessage] = useState("");
  const [backendErrors, setBackendErrors] = useState<Partial<Record<AuthField, string>>>({});
  const [pending, setPending] = useState(false);
  const errors = validateRegisterForm(values);
  const visibleErrors = {
    ...(submitted ? errors : Object.fromEntries(Object.entries(errors).filter(([field]) => touched[field as AuthField]))),
    ...backendErrors,
  };

  useEffect(() => {
    if (status === "authenticated") router.replace("/dashboard");
  }, [router, status]);

  if (status === "authenticated") {
    return <p className="mt-8 text-sm text-slate-300">Opening your workspace...</p>;
  }
  if (status === "loading") return <p className="mt-8 text-sm text-slate-300">Checking your session...</p>;

  function update(field: AuthField, value: string) {
    setValues((current) => ({ ...current, [field]: value }));
    setBackendErrors((current) => ({ ...current, [field]: undefined }));
    setServerMessage("");
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitted(true);
    setTouched({ name: true, email: true, password: true, confirmPassword: true });
    if (Object.keys(errors).length > 0) return;
    setPending(true);
    setServerMessage("");
    setBackendErrors({});
    try {
      await registerUser({ name: values.name.trim(), email: values.email.trim().toLowerCase(), password: values.password });
      router.replace("/login?registered=1");
    } catch (error: unknown) {
      if (error instanceof ApiClientError && error.code === "VALIDATION_ERROR") {
        setBackendErrors(applyFieldErrors<AuthField>(error.details, ["name", "email", "password"]));
        setServerMessage("Please review the highlighted fields.");
        setTouched({ name: true, email: true, password: true, confirmPassword: true });
      } else if (error instanceof ApiClientError && error.code === "EMAIL_ALREADY_EXISTS") {
        setServerMessage("An account with this email already exists");
      } else {
        setServerMessage("Unable to create your account right now. Please try again.");
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="mt-8 space-y-5" onSubmit={submit} noValidate>
      <AuthInput id="register-name" label="Name" type="text" autoComplete="name" value={values.name} error={visibleErrors.name} onChange={(value) => update("name", value)} onBlur={() => setTouched((current) => ({ ...current, name: true }))} />
      <AuthInput id="register-email" label="Email" type="email" autoComplete="email" value={values.email} error={visibleErrors.email} onChange={(value) => update("email", value)} onBlur={() => setTouched((current) => ({ ...current, email: true }))} />
      <AuthInput id="register-password" label="Password" type="password" autoComplete="new-password" value={values.password} error={visibleErrors.password} onChange={(value) => update("password", value)} onBlur={() => setTouched((current) => ({ ...current, password: true }))} />
      <AuthInput id="register-confirm-password" label="Confirm password" type="password" autoComplete="new-password" value={values.confirmPassword} error={visibleErrors.confirmPassword} onChange={(value) => update("confirmPassword", value)} onBlur={() => setTouched((current) => ({ ...current, confirmPassword: true }))} />
      <p className="min-h-6 text-sm text-red-300" aria-live="polite">{serverMessage}</p>
      <button type="submit" disabled={pending || Object.keys(errors).length > 0} className="w-full rounded-lg bg-cyan-300 px-4 py-3 text-sm font-semibold text-slate-950 disabled:cursor-not-allowed disabled:opacity-50">{pending ? "Creating account..." : "Create account"}</button>
      <p className="text-center text-sm text-slate-400">Already have an account? <Link className="text-cyan-300 hover:text-cyan-200" href="/login">Sign in</Link></p>
    </form>
  );
}

interface AuthInputProps {
  id: string;
  label: string;
  type: "text" | "email" | "password";
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
