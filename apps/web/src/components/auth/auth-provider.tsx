"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  ApiClientError,
  getCurrentUser,
  loginUser,
  logoutUser,
  type PublicUser,
} from "@/lib/api/auth-client";

type AuthStatus = "loading" | "authenticated" | "unauthenticated" | "error";

interface AuthContextValue {
  status: AuthStatus;
  user: PublicUser | null;
  errorMessage: string | null;
  retry: () => Promise<void>;
  invalidateSession: () => void;
  login: (email: string, password: string) => Promise<PublicUser>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [user, setUser] = useState<PublicUser | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const restoreSession = useCallback(async () => {
    setStatus("loading");
    setErrorMessage(null);
    try {
      setUser(await getCurrentUser());
      setStatus("authenticated");
    } catch (error: unknown) {
      setUser(null);
      if (error instanceof ApiClientError && error.status === 401) {
        setStatus("unauthenticated");
      } else {
        setStatus("error");
        setErrorMessage("Your session is temporarily unavailable.");
      }
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void restoreSession(), 0);
    return () => window.clearTimeout(timer);
  }, [restoreSession]);

  const login = useCallback(async (email: string, password: string) => {
    const authenticatedUser = await loginUser({ email, password });
    setUser(authenticatedUser);
    setStatus("authenticated");
    setErrorMessage(null);
    return authenticatedUser;
  }, []);

  const logout = useCallback(async () => {
    try {
      await logoutUser();
    } finally {
      setUser(null);
      setStatus("unauthenticated");
    }
  }, []);

  const invalidateSession = useCallback(() => {
    setUser(null);
    setStatus("unauthenticated");
    setErrorMessage(null);
  }, []);

  const value = useMemo(
    () => ({
      status,
      user,
      errorMessage,
      retry: restoreSession,
      invalidateSession,
      login,
      logout,
    }),
    [status, user, errorMessage, restoreSession, invalidateSession, login, logout],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within AuthProvider");
  return context;
}
