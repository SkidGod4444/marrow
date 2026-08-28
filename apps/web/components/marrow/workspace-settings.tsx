"use client";

import { Copy, KeyRound, Link2, Pencil, Trash2, UserPlus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { Me } from "@/lib/api";
import { authClient } from "@/lib/auth-client";
import { type NamespaceRow, useApiKeysQuery, useDeleteNamespace, useNamespacesQuery, useRenameNamespace, useWorkspaceMutation, useWorkspaceQuery } from "@/lib/queries";
import { fmtDay } from "@/lib/time";

// The client plugin only knows the default roles; the server validates against the full matrix.
type InviteRole = Parameters<typeof authClient.organization.inviteMember>[0]["role"];

const ROLES = ["viewer", "member", "admin", "owner"] as const;
const ROLE_HELP: Record<string, string> = {
  viewer: "Read, search and practise — cannot add or chat (chat costs money).",
  member: "Everything a viewer can, plus add videos and text, follow feeds, skip, chat, and make API keys.",
  admin: "Everything a member can, plus create/delete namespaces and manage members and invitations.",
  owner: "Everything, including deleting the workspace and changing owners.",
};

/** Members, invitations (links you copy — Marrow sends no e-mail), namespaces, and personal API keys for this workspace. */
export function WorkspaceSettings({ me }: { me: Me }) {
  const org = me.active!;
  const router = useRouter();
  const canManage = me.permissions.includes("member:update") || me.permissions.includes("invitation:create") || org.role === "owner" || org.role === "admin";
  const workspace = useWorkspaceQuery(org.id);
  const apiKeys = useApiKeysQuery(org.id);
  const members = workspace.data?.members ?? [];
  const invites = workspace.data?.invitations ?? [];
  const keys = apiKeys.data ?? [];
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<string>("member");
  const [keyName, setKeyName] = useState("");
  const [fresh, setFresh] = useState<string | null>(null);

  const changeRole = useWorkspaceMutation(org.id, ({ memberId, role: r }: { memberId: string; role: (typeof ROLES)[number]; email: string }) => authClient.organization.updateMemberRole({ memberId, role: r, organizationId: org.id }), (v) => `${v.email} is now ${v.role}`);
  const remove = useWorkspaceMutation(org.id, ({ memberId }: { memberId: string; email: string }) => authClient.organization.removeMember({ memberIdOrEmail: memberId, organizationId: org.id }), (v) => `${v.email} removed`);
  const invite = useWorkspaceMutation(org.id, (v: { email: string; role: (typeof ROLES)[number] }) => authClient.organization.inviteMember({ email: v.email, role: v.role as InviteRole, organizationId: org.id }), "Invitation created — copy the link and send it");
  const cancel = useWorkspaceMutation(org.id, ({ id }: { id: string }) => authClient.organization.cancelInvitation({ invitationId: id }), "Invitation cancelled");
  const createKey = useWorkspaceMutation(org.id, (v: { name: string }) => authClient.apiKey.create({ name: v.name, metadata: { organizationId: org.id } }), "Key created — copy it now");
  const revokeKey = useWorkspaceMutation(org.id, ({ id }: { id: string }) => authClient.apiKey.delete({ keyId: id }), "Key revoked");
  const busy = changeRole.isPending || remove.isPending || invite.isPending || cancel.isPending || createKey.isPending || revokeKey.isPending;
  const inviteLink = (id: string) => `${window.location.origin}/invite/${id}`;

  // Namespaces: rename (namespace:update) and delete (namespace:delete) — admins and owners.
  const canRename = me.permissions.includes("namespace:update");
  const canDelete = me.permissions.includes("namespace:delete");
  const nsQuery = useNamespacesQuery();
  const nsList = nsQuery.data ?? [];
  const rename = useRenameNamespace();
  const deleteNs = useDeleteNamespace();
  const [renaming, setRenaming] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [deleting, setDeleting] = useState<NamespaceRow | null>(null);
  const busyNs = rename.isPending || deleteNs.isPending;
  const submitRename = (n: NamespaceRow) => {
    const name = newName.trim().toLowerCase();
    if (!name || name === n.name) return setRenaming(null);
    rename.mutate(
      { id: n.id, name },
      {
        onSuccess: () => {
          setRenaming(null);
          router.refresh();
        },
      },
    );
  };
  const copy = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`${what} copied`);
    } catch {
      toast.error("Couldn't copy", { description: text });
    }
  };

  return (
    <div className="space-y-10">
      <section className="space-y-3" aria-labelledby="members">
        <h2 id="members" className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
          Members · {members.length}
        </h2>
        <ul className="divide-y divide-border/70 border-y border-border/70">
          {members.map((m) => {
            const self = m.userId === me.user.id;
            return (
              <li key={m.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3">
                <div className="min-w-0 flex-1">
                  <p className="reading text-[15px]">
                    {m.user.name || m.user.email}
                    {self && <span className="ml-2 font-mono text-[10px] uppercase text-muted-foreground">you</span>}
                  </p>
                  <p className="font-mono text-[11px] text-muted-foreground">{m.user.email}</p>
                </div>
                {canManage && !self ? (
                  <Select value={m.role} onValueChange={(v) => v && changeRole.mutate({ memberId: m.id, role: v as (typeof ROLES)[number], email: m.user.email })}>
                    <SelectTrigger className="w-32 font-mono text-[12px]" aria-label={`Role of ${m.user.email}`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ROLES.map((r) => (
                        <SelectItem key={r} value={r} className="font-mono text-[12px]">
                          {r}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <span className="rounded-md border border-border px-1.5 py-px font-mono text-[10px] uppercase tracking-wide text-muted-foreground">{m.role}</span>
                )}
                {canManage && !self && (
                  <Button variant="ghost" size="icon-sm" aria-label={`Remove ${m.user.email}`} disabled={busy} onClick={() => remove.mutate({ memberId: m.id, email: m.user.email })}>
                    <Trash2 />
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[12px] text-muted-foreground">
          {ROLES.map((r) => (
            <div key={r} className="contents">
              <dt className="font-mono">{r}</dt>
              <dd>{ROLE_HELP[r]}</dd>
            </div>
          ))}
        </dl>
      </section>

      {canManage && (
        <section className="space-y-3" aria-labelledby="invites">
          <h2 id="invites" className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
            Invite someone
          </h2>
          <form
            className="flex flex-wrap items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (!email.trim()) return;
              invite.mutate({ email: email.trim(), role: role as (typeof ROLES)[number] }, { onSuccess: () => setEmail("") });
            }}
          >
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email address" className="w-64" aria-label="Email to invite" />
            <Select value={role} onValueChange={(v) => v && setRole(v)}>
              <SelectTrigger className="w-32 font-mono text-[12px]" aria-label="Role for the invitee">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ROLES.filter((r) => r !== "owner").map((r) => (
                  <SelectItem key={r} value={r} className="font-mono text-[12px]">
                    {r}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button type="submit" size="sm" disabled={busy || !email.trim()}>
              <UserPlus />
              Create invitation
            </Button>
          </form>
          <p className="text-[12px] text-muted-foreground">Marrow doesn&apos;t send e-mail: you get a link to pass on. The invitee signs up (or in) with that address and accepts.</p>
          {invites.length > 0 && (
            <ul className="divide-y divide-border/70 border-y border-border/70">
              {invites.map((i) => (
                <li key={i.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="font-mono text-[12px]">
                      {i.email} <span className="text-muted-foreground">· {i.role ?? "member"} · expires {fmtDay(i.expiresAt)}</span>
                    </p>
                  </div>
                  <Button variant="outline" size="xs" onClick={() => void copy(inviteLink(i.id), "Invite link")}>
                    <Link2 />
                    Copy link
                  </Button>
                  <Button variant="ghost" size="icon-xs" aria-label={`Cancel invitation for ${i.email}`} disabled={busy} onClick={() => cancel.mutate({ id: i.id })}>
                    <Trash2 />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <section className="space-y-3" aria-labelledby="namespaces">
        <h2 id="namespaces" className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
          Namespaces · {nsList.length}
        </h2>
        <ul className="divide-y divide-border/70 border-y border-border/70">
          {nsList.map((n) => (
            <li key={n.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3">
              {renaming === n.id ? (
                <form
                  className="flex min-w-0 flex-1 flex-wrap items-center gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    submitRename(n);
                  }}
                >
                  <Input value={newName} onChange={(e) => setNewName(e.target.value)} autoFocus aria-label={`New name for ${n.name}`} className="w-56 font-mono text-[13px]" pattern="[a-z0-9][a-z0-9_\-]{0,63}" title="Lowercase letters, digits, - or _" />
                  <Button type="submit" size="xs" disabled={busyNs || !newName.trim() || newName.trim().toLowerCase() === n.name}>
                    Save
                  </Button>
                  <Button type="button" size="xs" variant="ghost" onClick={() => setRenaming(null)}>
                    Cancel
                  </Button>
                </form>
              ) : (
                <div className="min-w-0 flex-1">
                  <p className="font-mono text-[14px]">
                    {n.name}
                    {n.flags?.language_learning && <span className="ml-2 rounded-md border border-border px-1.5 py-px font-mono text-[10px] uppercase tracking-wide text-muted-foreground">language</span>}
                  </p>
                  <p className="font-mono text-[11px] text-muted-foreground">
                    {n.itemCount} item{n.itemCount === 1 ? "" : "s"} · {n.readyCount} ready
                  </p>
                </div>
              )}
              {canRename && renaming !== n.id && (
                <Button
                  variant="outline"
                  size="xs"
                  disabled={busyNs}
                  onClick={() => {
                    setRenaming(n.id);
                    setNewName(n.name);
                  }}
                >
                  <Pencil />
                  Rename
                </Button>
              )}
              {canDelete && (
                <Button variant="ghost" size="icon-sm" aria-label={`Delete ${n.name}`} disabled={busyNs} onClick={() => setDeleting(n)}>
                  <Trash2 />
                </Button>
              )}
            </li>
          ))}
          {nsList.length === 0 && <li className="py-2 text-sm text-muted-foreground">{nsQuery.isPending ? "Loading…" : "No namespaces yet — add something in the library and one is created with it."}</li>}
        </ul>
        {(canRename || canDelete) && <p className="text-[12px] text-muted-foreground">Renaming changes the namespace&apos;s links. Deleting removes every item in it — transcripts, articles, clips — for everyone in the workspace.</p>}
        <Dialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
          <DialogContent className="sm:max-w-sm">
            <DialogHeader>
              <DialogTitle className="reading">Delete {deleting?.name}?</DialogTitle>
              <DialogDescription>
                This removes the namespace and its {deleting?.itemCount ?? 0} item{deleting?.itemCount === 1 ? "" : "s"} — transcripts, articles, clips, everything — for everyone in {org.name}. There is no undo.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button type="button" variant="ghost" size="sm" onClick={() => setDeleting(null)}>
                Keep it
              </Button>
              <Button
                type="button"
                variant="destructive"
                size="sm"
                disabled={busyNs}
                onClick={() =>
                  deleting &&
                  deleteNs.mutate(
                    { id: deleting.id, name: deleting.name },
                    {
                      onSuccess: () => {
                        setDeleting(null);
                        router.refresh();
                      },
                    },
                  )
                }
              >
                {deleteNs.isPending ? "Deleting…" : `Delete ${deleting?.name ?? ""}`}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </section>

      <section className="space-y-3" aria-labelledby="api-keys" id="api-keys">
        <h2 className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">API keys for this workspace</h2>
        <p className="reading text-[15px] text-muted-foreground">A key acts as you, inside this workspace, with your role — for Claude Code (MCP), the share-sheet shortcut, or scripts. Shown once; revoke any time.</p>
        {me.permissions.includes("apikey:manage") ? (
          <form
            className="flex flex-wrap items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              createKey.mutate(
                { name: keyName.trim() || "API key" },
                {
                  onSuccess: (data) => {
                    setFresh((data as { key: string }).key);
                    setKeyName("");
                  },
                },
              );
            }}
          >
            <Input value={keyName} onChange={(e) => setKeyName(e.target.value)} placeholder="Name, e.g. Claude Code on my laptop" className="w-72" aria-label="Key name" />
            <Button type="submit" size="sm" disabled={busy}>
              <KeyRound />
              Create key
            </Button>
          </form>
        ) : (
          <p className="text-[12px] text-muted-foreground">Viewers can&apos;t create API keys in this workspace.</p>
        )}
        {fresh && (
          <div className="space-y-2 rounded-lg border border-time/40 bg-card px-4 py-3">
            <p className="text-[12px] text-muted-foreground">Your new key — it won&apos;t be shown again:</p>
            <div className="flex flex-wrap items-center gap-2">
              <code className="rounded-md bg-muted px-2 py-1 font-mono text-[12px] break-all">{fresh}</code>
              <Button variant="outline" size="xs" onClick={() => void copy(fresh, "Key")}>
                <Copy />
                Copy
              </Button>
            </div>
            <p className="font-mono text-[11px] text-muted-foreground">claude mcp add --transport http marrow {typeof window === "undefined" ? "" : ""}&lt;api-host&gt;/mcp --header &quot;x-api-key: {fresh.slice(0, 8)}…&quot;</p>
          </div>
        )}
        <ul className="divide-y divide-border/70 border-y border-border/70">
          {keys.map((k) => (
            <li key={k.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="text-[14px]">{k.name ?? "API key"}</p>
                <p className="font-mono text-[11px] text-muted-foreground">
                  {k.start ?? "mrw_"}… · created {fmtDay(k.createdAt)}
                </p>
              </div>
              <Button variant="ghost" size="xs" className="text-muted-foreground" disabled={busy} onClick={() => revokeKey.mutate({ id: k.id })}>
                <Trash2 />
                Revoke
              </Button>
            </li>
          ))}
          {keys.length === 0 && <li className="py-2 text-sm text-muted-foreground">{apiKeys.isPending ? "Loading…" : "No keys yet."}</li>}
        </ul>
      </section>
    </div>
  );
}
