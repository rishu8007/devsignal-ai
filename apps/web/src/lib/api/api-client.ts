"use client";

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

function isErrorResponse(value: unknown): value is ErrorResponse {
  if (!isRecord(value) || value.success !== false || !isRecord(value.error)) return false;
  return typeof value.error.code === "string" && typeof value.error.message === "string";
}

function getBaseUrl(): string | null {
  const configuredUrl = process.env.NEXT_PUBLIC_API_BASE_URL;
  if (!configuredUrl) return null;

  try {
    return new URL(configuredUrl).toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

export async function request<T>(
  path: string,
  options: RequestInit & { timeoutMs?: number },
  isValidResponse: (value: unknown) => value is T,
): Promise<T> {
  const baseUrl = getBaseUrl();
  if (!baseUrl) {
    throw new ApiClientError("The API is unavailable.", 0, "CLIENT_CONFIGURATION_ERROR");
  }

  const controller = new AbortController();
  const abortFromCaller = () => controller.abort();
  options.signal?.addEventListener("abort", abortFromCaller, { once: true });
  const timeout = options.timeoutMs
    ? window.setTimeout(() => controller.abort(), options.timeoutMs)
    : undefined;
  const signal = controller.signal;
  let response: Response;
  try {
    response = await fetch(`${baseUrl}${path}`, {
      ...options,
      signal,
      credentials: "include",
      cache: "no-store",
      headers: {
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...options.headers,
      },
    });
  } catch {
    if (signal.aborted) {
      if (timeout !== undefined) window.clearTimeout(timeout);
      if (options.signal?.aborted) {
        options.signal.removeEventListener("abort", abortFromCaller);
        throw new ApiClientError("The API request was cancelled.", 0, "REQUEST_ABORTED");
      }
      options.signal?.removeEventListener("abort", abortFromCaller);
      throw new ApiClientError("The API request timed out.", 0, "REQUEST_TIMEOUT");
    }
    if (timeout !== undefined) window.clearTimeout(timeout);
    options.signal?.removeEventListener("abort", abortFromCaller);
    throw new ApiClientError("The API is unavailable.", 0, "NETWORK_ERROR");
  }
  if (timeout !== undefined) window.clearTimeout(timeout);
  options.signal?.removeEventListener("abort", abortFromCaller);

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new ApiClientError(
      "The API returned an unexpected response.",
      response.status,
      "INVALID_RESPONSE",
    );
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
    throw new ApiClientError(
      "The API returned an unexpected response.",
      response.status,
      "INVALID_RESPONSE",
    );
  }

  if (!isValidResponse(payload)) {
    throw new ApiClientError(
      "The API returned an unexpected response.",
      response.status,
      "INVALID_RESPONSE",
    );
  }

  return payload;
}
