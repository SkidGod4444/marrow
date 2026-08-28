import Link from "next/link";

/** Public pages (landing, share pages): a floating pill of a header and the page — no sign-in gate, no app chrome. */
export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <header className="fixed inset-x-0 top-3 z-40 flex justify-center px-3 sm:top-4">
        <div className="flex h-11 w-full max-w-3xl items-center gap-4 rounded-2xl border border-border/70 bg-background/55 pl-3.5 pr-2 shadow-[inset_0_1px_0_0_color-mix(in_oklab,var(--foreground)_6%,transparent)] backdrop-blur-md">
          <Link href="/" className="flex items-center gap-2.5 font-serif text-[18px] font-semibold tracking-tight">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/marrow-mark.png?v=2" alt="" width={22} height={22} className="size-[22px] rounded-[5px]" />
            Marrow
          </Link>
          <nav aria-label="Account" className="ml-auto flex items-center pr-2">
            <Link href="/login" className="text-[13px] text-muted-foreground hover:text-foreground">
              Sign in
            </Link>
          </nav>
        </div>
      </header>
      <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 pt-20 pb-6 sm:px-5 sm:pt-24 sm:pb-8">
        {children}
      </main>
    </>
  );
}
