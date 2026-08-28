import Link from "next/link";
import { Button } from "@/components/ui/button";

/** Public pages (share pages): a brand line and the page — no sign-in, no app chrome. */
export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <header className="border-b border-border/70 bg-card">
        <div className="mx-auto flex h-12 max-w-6xl items-center gap-4 px-4 sm:gap-6 sm:px-5">
          <Link href="/" className="flex items-center gap-2.5 font-serif text-[19px] font-semibold tracking-tight">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/marrow-mark.png?v=2" alt="" width={22} height={22} className="size-[22px] rounded-[5px]" />
            Marrow
          </Link>
          <p className="hidden text-[13px] text-muted-foreground sm:block">Talks and podcasts, turned into readable, searchable knowledge.</p>
          <nav aria-label="Account" className="ml-auto flex items-center gap-3">
            <Link href="/login" className="text-[13px] text-muted-foreground hover:text-foreground">
              Sign in
            </Link>
            <Button size="sm" nativeButton={false} render={<Link href="/signup" />}>
              Create account
            </Button>
          </nav>
        </div>
      </header>
      <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-5 sm:py-8">
        {children}
      </main>
    </>
  );
}
