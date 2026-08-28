import { InviteCard } from "@/components/marrow/invite-card";

export const dynamic = "force-dynamic";
export const metadata = { title: "Invitation" };

/** Accept an invitation link. The invitee must be signed in with the invited email (the gate sends them to /login first). */
export default async function InvitePage({ params }: PageProps<"/invite/[id]">) {
  const { id } = await params;
  return (
    <div className="mx-auto max-w-md">
      <InviteCard id={id} />
    </div>
  );
}
