import "server-only";
import { headers } from "next/headers";
import { API_URL, apiHeaders } from "./api";

// Owner login (Better Auth on the API server). The web app never sees passwords: sign-in/up go through /api/auth
// (proxied), and every page checks the session cookie against the server. MARROW_AUTH=off removes the gate (dev only).

export const AUTH_ENABLED = process.env.MARROW_AUTH !== "off";
export type Session = { user: { id: string; email: string; name: string }; session: { expiresAt: string } };

/** The session for the current request (reads the incoming cookie), or null. */
export async function getSession(): Promise<Session | null> {
  if (!AUTH_ENABLED) return { user: { id: "local", email: "local@marrow", name: "Local" }, session: { expiresAt: "" } };
  const cookie = (await headers()).get("cookie");
  if (!cookie?.includes("session_token")) return null;
  try {
    const res = await fetch(`${API_URL}/api/auth/get-session`, { headers: { cookie }, cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as Session | null;
  } catch {
    return null;
  }
}

/** Has the owner account been created yet? (Drives the login page: first visit creates it.) */
export async function authStatus(): Promise<{ enabled: boolean; has_owner: boolean }> {
  try {
    const res = await fetch(`${API_URL}/auth/status`, { headers: apiHeaders(), cache: "no-store" });
    if (!res.ok) return { enabled: AUTH_ENABLED, has_owner: true };
    return (await res.json()) as { enabled: boolean; has_owner: boolean };
  } catch {
    return { enabled: AUTH_ENABLED, has_owner: true };
  }
}
