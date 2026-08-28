import "server-only";
import { headers } from "next/headers";
import type { ExpressionView, InboxEntry, Item, ItemUsage, ItemWithJob, NamespaceGraph, NamespaceSummary, ReviewCard, Source, VideoDocument } from "@marrow/core";
import { ApiError, fetchWithRetry, readJson } from "./http";

export { ApiError };

// Server-side client for the Marrow API. Requests run as the signed-in user: the browser's session cookie is forwarded
// to the API (which resolves the workspace and role from it). Client components go through app/api/marrow/[...path].

export const API_URL = (process.env.MARROW_API_URL ?? "http://localhost:3001").replace(/\/$/, "");
const API_KEY = process.env.MARROW_API_KEY;
export const AUTH_OFF = process.env.MARROW_AUTH === "off";

/** Headers that identify the caller: the request's cookie (signed-in user) — or, with auth off, the instance key. */
export async function callerHeaders(extra: Record<string, string> = {}): Promise<Record<string, string>> {
  const h = await headers();
  const cookie = h.get("cookie");
  const org = h.get("x-marrow-org");
  return { ...(cookie ? { cookie } : {}), ...(org ? { "x-marrow-org": org } : {}), ...(AUTH_OFF && API_KEY ? { "x-api-key": API_KEY } : {}), ...extra };
}

/** Legacy: the instance key only (public endpoints and auth-off mode). */
export function apiHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return { ...(API_KEY ? { "x-api-key": API_KEY } : {}), ...extra };
}

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  // GETs ride out a restarting server (retried briefly); a reply that isn't JSON is an error, never data.
  const res = await fetchWithRetry(`${API_URL}${path}`, { ...init, headers: await callerHeaders({ "content-type": "application/json", ...(init.headers as Record<string, string>) }), cache: "no-store" });
  if (!res.ok) throw new ApiError(`${init.method ?? "GET"} ${path} → ${res.status}: ${(await res.text()).slice(0, 300)}`, res.status);
  return readJson<T>(res);
}

export type PresentedDocument = Omit<VideoDocument, "transcript"> & { transcript: VideoDocument["transcript"] | null; transcript_entries: number; transcript_truncated: boolean };
export type Me = {
  user: { id: string; email: string; name: string; via: "session" | "apikey" | "instance" };
  organizations: Array<{ id: string; name: string; slug: string; role: "owner" | "admin" | "member" | "viewer"; members: number }>;
  active: { id: string; name: string; slug: string; role: string } | null;
  permissions: string[];
};

export const api = {
  me: () => apiFetch<Me>("/me"),
  namespaces: () => apiFetch<{ namespaces: NamespaceSummary[] }>("/namespaces").then((r) => r.namespaces),
  items: (namespace: string, status?: string) => apiFetch<{ items: ItemWithJob[] }>(`/items?namespace=${encodeURIComponent(namespace)}${status ? `&status=${status}` : ""}`).then((r) => r.items),
  item: (id: string) => apiFetch<{ item: Item }>(`/items/${id}`).then((r) => r.item),
  usage: (id: string) => apiFetch<{ usage: ItemUsage }>(`/items/${id}/usage`).then((r) => r.usage),
  document: (id: string) => apiFetch<PresentedDocument>(`/items/${id}/document?transcript=full`),
  graph: (namespace: string) => apiFetch<NamespaceGraph>(`/namespaces/${encodeURIComponent(namespace)}/graph`),
  namespace: (ref: string) => apiFetch<{ namespaces: NamespaceSummary[] }>("/namespaces").then((r) => r.namespaces.find((n) => n.name === ref || n.id === ref) ?? null),
  inbox: (namespace?: string, archived = false) =>
    apiFetch<{ entries: InboxEntry[]; pending: InboxEntry[] }>(`/inbox?${new URLSearchParams({ ...(namespace ? { namespace } : {}), ...(archived ? { archived: "1" } : {}) }).toString()}`),
  sources: (namespace?: string) => apiFetch<{ sources: Source[] }>(`/sources${namespace ? `?namespace=${encodeURIComponent(namespace)}` : ""}`).then((r) => r.sources),
  expressions: (id: string) => apiFetch<{ item_id: string; title: string; expressions: ExpressionView[] }>(`/items/${id}/expressions`),
  reviews: (now?: string) => apiFetch<{ due: ReviewCard[]; upcoming: ReviewCard[]; total: number }>(`/reviews${now ? `?now=${encodeURIComponent(now)}` : ""}`),
  event: (id: string, kind: "read" | "skipped") => apiFetch<{ ok: true }>(`/items/${id}/events`, { method: "POST", body: JSON.stringify({ kind }) }).catch(() => undefined),
};
