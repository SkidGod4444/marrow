import "server-only";
import { headers } from "next/headers";
import { type Me, API_URL, AUTH_OFF, apiFetch } from "./api";

// Accounts live on the API server (Better Auth). The web app forwards the browser's cookie and asks the API who is
// calling (`/me`: user, workspaces, active workspace, permissions). MARROW_AUTH=off removes the gate (dev only).

export const AUTH_ENABLED = !AUTH_OFF;
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

/** Who is calling, in which workspace, with which permissions — null when not signed in. */
export async function getMe(): Promise<Me | null> {
  try {
    return await apiFetch<Me>("/me");
  } catch {
    return null;
  }
}

export const can = (me: Me | null | undefined, permission: string) => Boolean(me?.permissions.includes(permission));
