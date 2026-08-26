import "server-only";
import type { InboxEntry, Item, NamespaceGraph, NamespaceSummary, Source, VideoDocument } from "@marrow/core";

// Server-side client for the Marrow API. The API key never reaches the browser; client components go through
// the proxy at app/api/marrow/[...path]/route.ts instead.

export const API_URL = (process.env.MARROW_API_URL ?? "http://localhost:3001").replace(/\/$/, "");
const API_KEY = process.env.MARROW_API_KEY;

export function apiHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return { ...(API_KEY ? { "x-api-key": API_KEY } : {}), ...extra };
}

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, { ...init, headers: apiHeaders({ "content-type": "application/json", ...(init.headers as Record<string, string>) }), cache: "no-store" });
  if (!res.ok) throw new Error(`${init.method ?? "GET"} ${path} → ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return (await res.json()) as T;
}

export type PresentedDocument = Omit<VideoDocument, "transcript"> & { transcript: VideoDocument["transcript"] | null; transcript_entries: number; transcript_truncated: boolean };

export const api = {
  namespaces: () => apiFetch<{ namespaces: NamespaceSummary[] }>("/namespaces").then((r) => r.namespaces),
  items: (namespace: string, status?: string) => apiFetch<{ items: Item[] }>(`/items?namespace=${encodeURIComponent(namespace)}${status ? `&status=${status}` : ""}`).then((r) => r.items),
  item: (id: string) => apiFetch<{ item: Item }>(`/items/${id}`).then((r) => r.item),
  document: (id: string) => apiFetch<PresentedDocument>(`/items/${id}/document?transcript=full`),
  graph: (namespace: string) => apiFetch<NamespaceGraph>(`/namespaces/${encodeURIComponent(namespace)}/graph`),
  namespace: (ref: string) => apiFetch<{ namespaces: NamespaceSummary[] }>("/namespaces").then((r) => r.namespaces.find((n) => n.name === ref || n.id === ref) ?? null),
  inbox: (namespace?: string) => apiFetch<{ entries: InboxEntry[]; pending: InboxEntry[] }>(`/inbox${namespace ? `?namespace=${encodeURIComponent(namespace)}` : ""}`),
  sources: (namespace?: string) => apiFetch<{ sources: Source[] }>(`/sources${namespace ? `?namespace=${encodeURIComponent(namespace)}` : ""}`).then((r) => r.sources),
  event: (id: string, kind: "read" | "skipped") => apiFetch<{ ok: true }>(`/items/${id}/events`, { method: "POST", body: JSON.stringify({ kind }) }).catch(() => undefined),
};
