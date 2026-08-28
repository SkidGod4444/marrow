"use client";

import type { Me } from "@/lib/api";
import { useMeQuery } from "@/lib/queries";

/** The signed-in caller (workspace, role, permissions). Seeded by the app layout, kept fresh by TanStack Query. */
export function MeProvider({ me, children }: { me: Me | null; children: React.ReactNode }) {
  useMeQuery(me);
  return <>{children}</>;
}
export function useMe(): Me | null {
  const q = useMeQuery(undefined, { enabled: false });
  return q.data ?? null;
}
/** `useCan("item:add")` — false when signed out or the role lacks it. Server-side checks remain the authority. */
export function useCan(permission: string): boolean {
  const me = useMe();
  return Boolean(me?.permissions.includes(permission));
}
