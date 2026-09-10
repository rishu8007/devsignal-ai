"use client";

export interface PublicUser {
  id: string;
  name: string;
  email: string;
  role: "user";
  createdAt: string;
}

export interface ApiErrorDetails {
  fields?: Record<string, string[]>;
}

export class ApiClientError extends Error {
  public readonly status: number;
  public readonly code: string;
  public readonly details: ApiErrorDetails | undefined;

  public constructor(
    message: string,
    status: number,
    code: string,
    details?: ApiErrorDetails,
  ) {
    super(message);
    this.name = "ApiClientError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

interface UserResponse {
  success: true;
  data: { user: PublicUser };
}

interface LogoutResponse {
  success: true;
  data: { message: string };
}

interface ErrorResponse {
  success: false;
  error: {
    code: string;
    message: string;
    details?: ApiErrorDetails;
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isPublicUser(value: unknown): value is PublicUser {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    typeof value.email === "string" &&
    value.role === "user" &&
    typeof value.createdAt === "string"
  );
}

function isUserResponse(value: unknown): value is UserResponse {
  return (
    isRecord(value) &&
    value.success === true &&
    isRecord(value.data) &&
    isPublicUser(value.data.user)
  );
}

function isLogoutResponse(value: unknown): value is LogoutResponse {
  return (
    isRecord(value) &&
    value.success === true &&
    isRecord(value.data) &&
    typeof value.data.message === "string"
  );
}

function isErrorResponse(value: unknown): value is ErrorResponse {
  if (!isRecord(value) || value.success !== false || !isRecord(value.error)) return false;
  return typeof value.error.code === "string" && typeof value.error.message === "string";
}

function getBaseUrl(): string | null {
  const configuredUrl = process.env.NEXT_PUBLIC_API_BASE_URL;
  if (!configuredUrl) return null;

  try {
    const url = new URL(configuredUrl);
    return url.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

async function request<T>(
  path: string,
  options: RequestInit,
  isValidResponse: (value: unknown) => value is T,
): Promise<T> {
  const baseUrl = getBaseUrl();
  if (!baseUrl) {
    throw new ApiClientError("The API is unavailable.", 0, "CLIENT_CONFIGURATION_ERROR");
  }

  let response: Response;
  try {
    response = await fetch(`${baseUrl}${path}`, {
      ...options,
      credentials: "include",
      cache: "no-store",
      headers: {
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...options.headers,
      },
    });
  } catch {
    throw new ApiClientError("The API is unavailable.", 0, "NETWORK_ERROR");
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new ApiClientError("The API returned an unexpected response.", response.status, "INVALID_RESPONSE");
  }

  if (!response.ok) {
    if (isErrorResponse(payload)) {
      throw new ApiClientError(
        payload.error.message,
        response.status,
        payload.error.code,
        payload.error.details,
      );
    }
    throw new ApiClientError("The API returned an unexpected response.", response.status, "INVALID_RESPONSE");
  }

  if (!isValidResponse(payload)) {
    throw new ApiClientError("The API returned an unexpected response.", response.status, "INVALID_RESPONSE");
  }

  return payload;
}

export async function registerUser(input: {
  name: string;
  email: string;
  password: string;
}): Promise<PublicUser> {
  const response = await request(
    "/auth/register",
    { method: "POST", body: JSON.stringify(input) },
    isUserResponse,
  );
  return response.data.user;
}

export async function loginUser(input: {
  email: string;
  password: string;
}): Promise<PublicUser> {
  const response = await request(
    "/auth/login",
    { method: "POST", body: JSON.stringify(input) },
    isUserResponse,
  );
  return response.data.user;
}

export async function getCurrentUser(): Promise<PublicUser> {
  const response = await request("/auth/me", { method: "GET" }, isUserResponse);
  return response.data.user;
}

export async function logoutUser(): Promise<void> {
  await request("/auth/logout", { method: "POST" }, isLogoutResponse);
}
