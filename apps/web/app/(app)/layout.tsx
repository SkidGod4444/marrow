import Link from "next/link";
import { redirect } from "next/navigation";
import { MeProvider } from "@/components/marrow/me-provider";
import { NavLinks } from "@/components/marrow/nav-links";
import { UserMenu } from "@/components/marrow/user-menu";
import { WorkspaceSwitcher } from "@/components/marrow/workspace-switcher";
import { api } from "@/lib/api";
import { AUTH_ENABLED, getMe } from "@/lib/auth";

export const dynamic = "force-dynamic";

/** Everything behind sign-in: header (brand, workspace, nav, account) + the page. The caller is verified against the API here. */
export default async function AppLayout({ children }: LayoutProps<"/">) {
  const me = await getMe();
  if (AUTH_ENABLED && !me) redirect("/login");
  const languageMode = (await api.namespaces().catch(() => [])).some((n) => n.flags?.language_learning);
  return (
    <MeProvider me={me}>
      <header className="border-b border-border/70 bg-card">
        <div className="mx-auto flex h-12 max-w-6xl items-center gap-3 px-4 sm:gap-6 sm:px-5">
          <Link href="/" className="flex items-center gap-2.5 font-serif text-[19px] font-semibold tracking-tight">
            {/* Plain <img>: next/image caches optimised copies by URL and kept serving a stale icon after the file changed. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/marrow-mark.png?v=2" alt="" width={22} height={22} className="size-[22px] rounded-[5px]" />
            <span className="hidden sm:inline">Marrow</span>
          </Link>
          {AUTH_ENABLED && me && me.user.via === "session" && <WorkspaceSwitcher me={me} />}
          <NavLinks languageMode={languageMode} />
          {AUTH_ENABLED && me && me.user.via === "session" && <UserMenu email={me.user.email} name={me.user.name} />}
        </div>
      </header>
      <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-5 sm:py-8">
        {children}
      </main>
    </MeProvider>
  );
}
