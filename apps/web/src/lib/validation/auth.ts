import type { ApiErrorDetails } from "@/lib/api/auth-client";

export interface RegisterFormValues {
  name: string;
  email: string;
  password: string;
  confirmPassword: string;
}

export interface LoginFormValues {
  email: string;
  password: string;
}

export type AuthField = keyof RegisterFormValues;
export type LoginField = keyof LoginFormValues;
export type AuthFieldErrors = Partial<Record<AuthField, string>>;
export type LoginFieldErrors = Partial<Record<LoginField, string>>;

export function validateRegisterForm(values: RegisterFormValues): AuthFieldErrors {
  const errors: AuthFieldErrors = {};
  const name = values.name.trim();
  const email = values.email.trim();

  if (name.length < 2) errors.name = "Name must contain at least 2 characters";
  else if (name.length > 80) errors.name = "Name must contain at most 80 characters";
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errors.email = "Enter a valid email address";
  } else if (email.length > 254) {
    errors.email = "Email address must contain at most 254 characters";
  }
  if (values.password.length < 10) {
    errors.password = "Password must contain at least 10 characters";
  } else if (new TextEncoder().encode(values.password).length > 72) {
    errors.password = "Password must not exceed 72 UTF-8 bytes";
  }
  if (values.password !== values.confirmPassword) {
    errors.confirmPassword = "Passwords do not match";
  }
  return errors;
}

export function validateLoginForm(values: LoginFormValues): LoginFieldErrors {
  const errors: LoginFieldErrors = {};
  const email = values.email.trim();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errors.email = "Enter a valid email address";
  } else if (email.length > 254) {
    errors.email = "Email address must contain at most 254 characters";
  }
  if (!values.password) errors.password = "Password is required";
  else if (new TextEncoder().encode(values.password).length > 72) {
    errors.password = "Password must not exceed 72 UTF-8 bytes";
  }
  return errors;
}

export function applyFieldErrors<Field extends string>(
  details: ApiErrorDetails | undefined,
  allowedFields: readonly Field[],
): Partial<Record<Field, string>> {
  const errors: Partial<Record<Field, string>> = {};
  for (const field of allowedFields) {
    const message = details?.fields?.[String(field)]?.[0];
    if (message) errors[field] = message;
  }
  return errors;
}
