"use client";

import { request, ApiClientError, type ApiErrorDetails } from "@/lib/api/api-client";

export { ApiClientError };
export type { ApiErrorDetails };

export interface PublicUser {
  id: string;
  name: string;
  email: string;
  role: "user";
  createdAt: string;
}

interface UserResponse {
  success: true;
  data: { user: PublicUser };
}

interface LogoutResponse {
  success: true;
  data: { message: string };
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
