"use client";

import { useRouter } from "next/navigation";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

/** Namespace-scoped pages (graph, chat): the namespace is a control, not a title. */
export function NamespaceSwitcher({ current, namespaces, page }: { current: string; namespaces: Array<{ name: string; readyCount: number }>; page: "graph" | "chat" }) {
  const router = useRouter();
  return (
    <Select value={current} items={namespaces.map((n) => ({ value: n.name, label: n.name }))} onValueChange={(v) => v && v !== current && router.push(`/namespaces/${encodeURIComponent(v)}/${page}`)}>
      <SelectTrigger className="h-8 min-w-40 font-serif text-[18px] font-semibold tracking-tight" aria-label="Namespace">
        <SelectValue />
      </SelectTrigger>
      <SelectContent align="start">
        {namespaces.map((n) => (
          <SelectItem key={n.name} value={n.name} className="font-mono text-[13px]">
            {n.name}
            <span className="ml-auto pl-4 text-[11px] text-muted-foreground">{n.readyCount}</span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
