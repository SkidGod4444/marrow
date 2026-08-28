"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";
import { useMe } from "./me-provider";

type Invitation = { id: string; organizationName: string; organizationSlug: string; role: string; email: string; status: string; inviterEmail?: string; expiresAt: string | Date };

export function InviteCard({ id }: { id: string }) {
  const me = useMe();
  const [inv, setInv] = useState<Invitation | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void authClient.organization.getInvitation({ query: { id } }).then((r) => setInv((r.data as Invitation | null) ?? null));
  }, [id]);

  const accept = async () => {
    setBusy(true);
    const r = await authClient.organization.acceptInvitation({ invitationId: id });
    if (r.error) {
      toast.error("Couldn't accept the invitation", { description: r.error.message });
      setBusy(false);
      return;
    }
    if (r.data?.member?.organizationId) await authClient.organization.setActive({ organizationId: r.data.member.organizationId });
    toast.success("You're in");
    window.location.assign("/");
  };

  if (inv === undefined) return <p className="text-sm text-muted-foreground">Checking the invitation…</p>;
  if (!inv) return <p className="reading text-[16px]">This invitation doesn&apos;t exist or has expired. Ask the person who sent it for a new link.</p>;
  const wrongEmail = me && me.user.email.toLowerCase() !== inv.email.toLowerCase();
  return (
    <div className="space-y-5 rounded-lg border border-border/70 bg-card px-6 py-7">
      <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">Invitation</p>
      <h1 className="reading text-[24px] font-semibold tracking-tight">
        Join <b className="font-semibold">{inv.organizationName}</b> as {inv.role}
      </h1>
      {inv.status !== "pending" ? (
        <p className="text-sm text-muted-foreground">This invitation was already {inv.status}.</p>
      ) : wrongEmail ? (
        <p className="text-sm text-destructive">
          It was sent to <span className="font-mono">{inv.email}</span>, but you are signed in as <span className="font-mono">{me?.user.email}</span>. Sign out and sign in (or sign up) with the invited address.
        </p>
      ) : (
        <Button disabled={busy} onClick={() => void accept()}>
          {busy ? "Joining…" : "Accept and join"}
        </Button>
      )}
    </div>
  );
}
