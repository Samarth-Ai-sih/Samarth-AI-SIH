"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import Cookies from "js-cookie";

// ── Types ───────────────────────────────────────────────────────

interface Jurisdiction {
  state_code: string | null;
  district_code: string | null;
  constituency: string | null;
  assigned_task_ids: string[];
}

interface User {
  user_id: string;
  email: string;
  username: string;
  full_name: string;
  role: string;
  jurisdiction: Jurisdiction;
  is_active: boolean;
  must_change_password: boolean;
  created_at: string;
  last_login: string | null;
}

interface AuthState {
  user: User | null;
  accessToken: string | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  csrfToken: string | null;
}

interface AuthContextType extends AuthState {
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshToken: () => Promise<string | null>;
  fetchWithAuth: (url: string, options?: RequestInit) => Promise<Response>;
}

const AuthContext = createContext<AuthContextType | null>(null);

// ── API base ────────────────────────────────────────────────────

const API_BASE = "/api/v1/auth";

// ── Provider ────────────────────────────────────────────────────

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>({
    user: null,
    accessToken: null,
    isLoading: true,
    isAuthenticated: false,
    csrfToken: null,
  });

  // Try to restore session on mount via refresh
  useEffect(() => {
    const finishUnauthenticated = () => {
      // A CSRF cookie is only a UX signal. Keeping it after refresh/profile
      // failure makes the proxy treat a stale browser session as authenticated
      // and can loop a user between /dashboard and /login.
      Cookies.remove("csrf_token", { path: "/" });
      setState({
        user: null,
        accessToken: null,
        isLoading: false,
        isAuthenticated: false,
        csrfToken: null,
      });
    };
    const tryRestore = async () => {
      const csrfToken = Cookies.get("csrf_token");
      if (!csrfToken) {
        finishUnauthenticated();
        return;
      }

      try {
        const res = await fetch(`${API_BASE}/refresh`, {
          method: "POST",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
            "X-CSRF-Token": csrfToken,
          },
        });

        if (!res.ok) {
          finishUnauthenticated();
          return;
        }

        const data = await res.json();
        // Fetch user profile with new token
        const meRes = await fetch(`${API_BASE}/me`, {
          headers: { Authorization: `Bearer ${data.access_token}` },
        });

        if (meRes.ok) {
          const user = await meRes.json();
          setState({
            user,
            accessToken: data.access_token,
            isLoading: false,
            isAuthenticated: true,
            csrfToken: data.csrf_token,
          });
        } else {
          finishUnauthenticated();
        }
      } catch {
        finishUnauthenticated();
      }
    };

    tryRestore();
  }, []);

  // Login
  const login = useCallback(async (email: string, password: string) => {
    const res = await fetch(`${API_BASE}/login`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: "Login failed" }));
      throw new Error(err.detail || "Login failed");
    }

    const data = await res.json();
    if (data.csrf_token) {
      Cookies.set("csrf_token", data.csrf_token, { path: "/", sameSite: "lax" });
    }
    setState({
      user: data.user,
      accessToken: data.access_token,
      isLoading: false,
      isAuthenticated: true,
      csrfToken: data.csrf_token,
    });
  }, []);

  // Logout
  const logout = useCallback(async () => {
    const csrfToken = state.csrfToken || Cookies.get("csrf_token");
    try {
      await fetch(`${API_BASE}/logout`, {
        method: "POST",
        credentials: "include",
        headers: {
          Authorization: `Bearer ${state.accessToken}`,
          "X-CSRF-Token": csrfToken || "",
        },
      });
    } catch {
      // Ignore errors — clear local state regardless
    }
    Cookies.remove("csrf_token", { path: "/" });
    setState({
      user: null,
      accessToken: null,
      isLoading: false,
      isAuthenticated: false,
      csrfToken: null,
    });
  }, [state.accessToken, state.csrfToken]);

  // Refresh
  const refreshToken = useCallback(async (): Promise<string | null> => {
    const csrfToken = state.csrfToken || Cookies.get("csrf_token");
    if (!csrfToken) return null;

    try {
      const res = await fetch(`${API_BASE}/refresh`, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": csrfToken,
        },
      });

      if (!res.ok) return null;

      const data = await res.json();
      setState((s) => ({
        ...s,
        accessToken: data.access_token,
        csrfToken: data.csrf_token,
      }));
      return data.access_token;
    } catch {
      return null;
    }
  }, [state.csrfToken]);

  // Fetch with auth (auto-refresh on 401)
  const fetchWithAuth = useCallback(
    async (url: string, options: RequestInit = {}): Promise<Response> => {
      const headers = new Headers(options.headers);
      if (state.accessToken) {
        headers.set("Authorization", `Bearer ${state.accessToken}`);
      }
      if (options.body && !(options.body instanceof FormData) && !headers.has("Content-Type")) {
        headers.set("Content-Type", "application/json");
      }

      let res = await fetch(url, { ...options, headers, credentials: "include" });

      // If 401, try refresh and retry once
      if (res.status === 401) {
        const refreshedToken = await refreshToken();
        if (refreshedToken) {
          headers.set("Authorization", `Bearer ${refreshedToken}`);
          res = await fetch(url, { ...options, headers, credentials: "include" });
        }
      }

      return res;
    },
    [state.accessToken, refreshToken]
  );

  const value = useMemo(
    () => ({
      ...state,
      login,
      logout,
      refreshToken,
      fetchWithAuth,
    }),
    [state, login, logout, refreshToken, fetchWithAuth]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// ── Hook ────────────────────────────────────────────────────────

export function useAuth(): AuthContextType {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return ctx;
}
