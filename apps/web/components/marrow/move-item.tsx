"use client";

import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useMoveItem, useNamespacesQuery } from "@/lib/queries";
import { useCan } from "./me-provider";

/** The item's namespace, in the meta line — a select for anyone who may add items, so a misfiled item is one pick away. */
export function MoveItem({ itemId, namespaceId }: { itemId: string; namespaceId: string }) {
  const router = useRouter();
  const canMove = useCan("item:add");
  const { data: namespaces } = useNamespacesQuery();
  const move = useMoveItem(itemId);
  const current = namespaces?.find((n) => n.id === namespaceId);
  if (!namespaces) return null;
  if (!canMove || namespaces.length < 2) return current ? <span>{current.name}</span> : null;
  return (
    <Select
      value={namespaceId}
      items={namespaces.map((n) => ({ value: n.id, label: n.name }))}
      onValueChange={(v) => {
        if (!v || v === namespaceId) return;
        move.mutate(
          { namespace: v },
          {
            onSuccess: (r) => {
              toast.success(`Moved to ${r.to}`, { description: r.job_id ? "Checking what's new here — and, in a language namespace, picking expressions." : undefined });
              router.refresh();
            },
          },
        );
      }}
    >
      <SelectTrigger className="h-6 w-auto gap-1 border-border/70 px-1.5 font-mono text-[11px]" aria-label="Namespace" disabled={move.isPending}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {namespaces.map((n) => (
          <SelectItem key={n.id} value={n.id} className="font-mono text-[12px]">
            {n.name}
            {n.flags?.language_learning ? <span className="ml-1.5 text-[10px] uppercase text-muted-foreground">language</span> : null}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
