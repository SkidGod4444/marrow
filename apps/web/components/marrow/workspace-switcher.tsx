"use client";

import { Check, ChevronsUpDown, Plus, Settings } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import type { Me } from "@/lib/api";
import { authClient } from "@/lib/auth-client";

const ROLE: Record<string, string> = { owner: "owner", admin: "admin", member: "member", viewer: "viewer" };

/** Header control: which workspace you're in, switch, create one, or open its settings. */
export function WorkspaceSwitcher({ me }: { me: Me }) {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  const switchTo = async (organizationId: string) => {
    const r = await authClient.organization.setActive({ organizationId });
    if (r.error) return toast.error("Couldn't switch workspace", { description: r.error.message });
    window.location.assign("/");
  };
  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    try {
      const slug = `${name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 32) || "workspace"}-${Math.random().toString(36).slice(2, 6)}`;
      const r = await authClient.organization.create({ name: name.trim(), slug });
      if (r.error || !r.data) throw new Error(r.error?.message ?? "Couldn't create the workspace");
      await authClient.organization.setActive({ organizationId: r.data.id });
      toast.success("Workspace created", { description: `You're now in ${name.trim()}.` });
      window.location.assign("/");
    } catch (err) {
      toast.error("Couldn't create the workspace", { description: (err as Error).message });
      setBusy(false);
    }
  };

  const active = me.active;
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="outline" size="sm" className="max-w-52 font-sans" aria-label={`Workspace: ${active?.name ?? "none"}`} />}>
          {/* Phones get the initial only; the full name is in the accessible label and the menu. */}
          <span className="font-mono text-[12px] sm:hidden" aria-hidden>
            {(active?.name ?? "?").slice(0, 1).toUpperCase()}
          </span>
          <span className="hidden truncate sm:inline">{active?.name ?? "Pick a workspace"}</span>
          <ChevronsUpDown className="size-3.5 text-muted-foreground" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-64 font-sans text-[13px]">
          <DropdownMenuGroup>
            <DropdownMenuLabel className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Workspaces</DropdownMenuLabel>
            {me.organizations.map((o) => (
              <DropdownMenuItem key={o.id} onClick={() => (o.id === active?.id ? undefined : void switchTo(o.id))}>
                <span className="flex size-4 items-center justify-center">{o.id === active?.id && <Check className="size-3.5" />}</span>
                <span className="min-w-0 flex-1 truncate">{o.name}</span>
                <span className="font-mono text-[10px] uppercase text-muted-foreground">{ROLE[o.role] ?? o.role}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          {active && (
            <DropdownMenuItem nativeButton={false} render={<Link href="/settings" />}>
              <Settings />
              Workspace settings
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onClick={() => setCreating(true)}>
            <Plus />
            New workspace
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent className="sm:max-w-sm">
          <form onSubmit={create} className="space-y-4">
            <DialogHeader>
              <DialogTitle className="reading">New workspace</DialogTitle>
              <DialogDescription>A separate space with its own namespaces and members. You become its owner and can invite people from its settings.</DialogDescription>
            </DialogHeader>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Robotics reading group" autoFocus aria-label="Workspace name" />
            <DialogFooter>
              <Button type="button" variant="ghost" size="sm" onClick={() => setCreating(false)}>
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={busy || !name.trim()}>
                {busy ? "Creating…" : "Create workspace"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
