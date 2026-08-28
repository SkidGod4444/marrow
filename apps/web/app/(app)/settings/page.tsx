import { WorkspaceSettings } from "@/components/marrow/workspace-settings";
import { getMe } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  const me = await getMe();
  return (
    <div className="mx-auto max-w-3xl space-y-10">
      <header className="space-y-1">
        <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">Settings</p>
        <h1 className="reading text-[28px] font-semibold tracking-tight">{me?.active?.name ?? "Workspace"}</h1>
        <p className="text-sm text-muted-foreground">Members and roles, invitations, and API keys for Claude Code or scripts.</p>
      </header>
      {me?.active ? <WorkspaceSettings me={me} /> : <p className="text-sm text-muted-foreground">Pick a workspace first.</p>}
    </div>
  );
}
