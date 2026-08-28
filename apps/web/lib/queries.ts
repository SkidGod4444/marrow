"use client";

import { type UseQueryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { Me } from "./api";
import { authClient } from "./auth-client";
import { errorFor, fetchWithRetry, readJson } from "./http";

// Client-side server state, in one place: query keys, fetchers and mutations (TanStack Query). Components never call
// fetch() for data themselves; they read a query and fire a mutation, and invalidation keeps every view in step.

export const keys = {
  me: ["me"] as const,
  reviewsSummary: ["reviews", "summary"] as const,
  namespaces: ["namespaces"] as const,
  workspace: (orgId: string) => ["workspace", orgId] as const,
  apiKeys: (orgId: string) => ["api-keys", orgId] as const,
  expressions: (itemId: string) => ["expressions", itemId] as const,
};

async function proxy<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetchWithRetry(`/api/marrow/${path}`, { ...init, headers: { "content-type": "application/json", ...init.headers }, cache: "no-store" });
  if (!res.ok) throw await errorFor(res);
  return readJson<T>(res);
}

// ---- who am I ----
export function useMeQuery(initial?: Me | null, opts: Partial<UseQueryOptions<Me | null>> = {}) {
  return useQuery<Me | null>({
    queryKey: keys.me,
    // A failed refresh keeps the last good answer (seeded by the layout); an odd-shaped one is treated as a failure too.
    queryFn: async () => {
      const me = await proxy<Me>("me");
      if (!me || !Array.isArray(me.permissions)) throw new Error("unexpected reply from /me");
      return me;
    },
    initialData: initial,
    staleTime: 60_000,
    retry: 2,
    ...opts,
  });
}

// ---- Practice ----
export type ReviewSummary = { due: number; total: number; next_due_at: string | null };
export function useReviewSummary(enabled = true) {
  return useQuery<ReviewSummary>({ queryKey: keys.reviewsSummary, queryFn: () => proxy<ReviewSummary>("reviews/summary"), enabled, refetchInterval: 5 * 60 * 1000 });
}
export function useLearnMutation(itemId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ n, saved }: { n: number; saved: boolean }) => proxy<{ review?: { dueAt: string } }>(`items/${itemId}/expressions/${n}/save`, { method: saved ? "DELETE" : "POST" }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.reviewsSummary }),
    onError: (err) => toast.error("Couldn't update review", { description: (err as Error).message }),
  });
}
export function useAnswerReview() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, result }: { id: string; result: "got_it" | "again" }) => proxy<{ review: { dueAt: string; stage: number } }>(`reviews/${id}/answer`, { method: "POST", body: JSON.stringify({ result }) }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.reviewsSummary }),
    onError: (err) => toast.error("Couldn't save that answer", { description: (err as Error).message }),
  });
}

// ---- Inbox ----
export function useArchiveMutation() {
  return useMutation({
    mutationFn: ({ id, archived }: { id: string; archived: boolean }) => proxy<{ item: unknown }>(`items/${id}/archive`, { method: "POST", body: JSON.stringify({ archived }) }),
  });
}
export function useIngestMutation() {
  return useMutation({
    mutationFn: (input: { namespace: string; url: string; force?: boolean }) => proxy<{ job_id: string; item_id: string; reused: boolean }>("ingest", { method: "POST", body: JSON.stringify(input) }),
  });
}

// ---- Namespaces (settings: rename / delete; admins and owners) ----
export type NamespaceRow = { id: string; name: string; description: string; flags: Record<string, boolean | undefined>; itemCount: number; readyCount: number };
export function useNamespacesQuery() {
  return useQuery({ queryKey: keys.namespaces, queryFn: () => proxy<{ namespaces: NamespaceRow[] }>("namespaces").then((r) => r.namespaces) });
}
export function useRenameNamespace() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: string; name: string }) => proxy<{ namespace: NamespaceRow }>(`namespaces/${v.id}`, { method: "PATCH", body: JSON.stringify({ name: v.name }) }),
    onSuccess: (r) => {
      toast.success(`Renamed to ${r.namespace.name}`, { description: "Links to the old name no longer work." });
      void qc.invalidateQueries({ queryKey: keys.namespaces });
    },
    onError: (err) => toast.error("Couldn't rename", { description: err.message }),
  });
}
export function useDeleteNamespace() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: string; name: string }) => proxy<{ ok: true }>(`namespaces/${v.id}`, { method: "DELETE" }),
    onSuccess: (_r, v) => {
      toast.success(`Deleted ${v.name}`);
      void qc.invalidateQueries({ queryKey: keys.namespaces });
      void qc.invalidateQueries({ queryKey: keys.reviewsSummary });
    },
    onError: (err) => toast.error("Couldn't delete", { description: err.message }),
  });
}

// ---- Workspace settings (Better Auth client is the transport; the cache is ours) ----
export type Member = { id: string; role: string; userId: string; user: { email: string; name: string } };
export type Invitation = { id: string; email: string; role: string | null; status: string; expiresAt: string | Date };
export type ApiKey = { id: string; name: string | null; start: string | null; createdAt: string | Date; metadata?: { organizationId?: string } | null };

export function useWorkspaceQuery(orgId: string) {
  return useQuery({
    queryKey: keys.workspace(orgId),
    queryFn: async () => {
      const r = await authClient.organization.getFullOrganization({ query: { organizationId: orgId } });
      if (r.error) throw new Error(r.error.message ?? "Couldn't load the workspace");
      const data = r.data as { members?: Member[]; invitations?: Invitation[] } | null;
      return { members: data?.members ?? [], invitations: (data?.invitations ?? []).filter((i) => i.status === "pending") };
    },
  });
}
export function useApiKeysQuery(orgId: string) {
  return useQuery({
    queryKey: keys.apiKeys(orgId),
    queryFn: async () => {
      const r = await authClient.apiKey.list();
      if (r.error) throw new Error(r.error.message ?? "Couldn't load API keys");
      const list = (r.data as { apiKeys?: ApiKey[] } | ApiKey[] | null) ?? [];
      const rows = Array.isArray(list) ? list : (list.apiKeys ?? []);
      return rows.filter((k) => (k.metadata as { organizationId?: string } | null)?.organizationId === orgId);
    },
  });
}
/** A mutation over the auth client that refreshes the workspace cache and reports in plain words. */
export function useWorkspaceMutation<TVars>(orgId: string, fn: (vars: TVars) => Promise<{ error?: { message?: string } | null; data?: unknown }>, ok: string | ((vars: TVars) => string)) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: TVars) => {
      const r = await fn(vars);
      if (r.error) throw new Error(r.error.message ?? "Something went wrong");
      return r.data;
    },
    onSuccess: (_data, vars) => {
      toast.success(typeof ok === "function" ? ok(vars) : ok);
      void qc.invalidateQueries({ queryKey: keys.workspace(orgId) });
      void qc.invalidateQueries({ queryKey: keys.apiKeys(orgId) });
      void qc.invalidateQueries({ queryKey: keys.me });
    },
    onError: (err) => toast.error("Couldn't do that", { description: (err as Error).message }),
  });
}
