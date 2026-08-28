import Link from "next/link";
import { redirect } from "next/navigation";
import { NavLinks } from "@/components/marrow/nav-links";
import { UserMenu } from "@/components/marrow/user-menu";
import { AUTH_ENABLED, getSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

/** Everything behind the owner's login: header + nav + the page. The session is verified against the server here. */
export default async function AppLayout({ children }: LayoutProps<"/">) {
  const session = await getSession();
  if (AUTH_ENABLED && !session) redirect("/login");
  return (
    <>
      <header className="border-b border-border/70 bg-card">
        <div className="mx-auto flex h-12 max-w-6xl items-center gap-6 px-4 sm:gap-8 sm:px-5">
          <Link href="/" className="flex items-center gap-2.5 font-serif text-[19px] font-semibold tracking-tight">
            {/* Plain <img>: next/image caches optimised copies by URL and kept serving a stale icon after the file changed. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/marrow-mark.png?v=2" alt="" width={22} height={22} className="size-[22px] rounded-[5px]" />
            Marrow
          </Link>
          <NavLinks />
          {AUTH_ENABLED && session && <UserMenu email={session.user.email} name={session.user.name} />}
        </div>
      </header>
      <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-5 sm:py-8">
        {children}
      </main>
    </>
  );
}
