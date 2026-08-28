"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { PracticeLink } from "./review-badge";

const LINKS = [
  { href: "/", label: "Inbox" },
  { href: "/library", label: "Library" },
  { href: "/graph", label: "Graph" },
];

/** Primary nav with an explicit current-page state (Nielsen #1: visibility of system status). */
export function NavLinks({ languageMode = false }: { languageMode?: boolean }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Primary" className="flex items-center gap-0.5 text-[13px] sm:gap-1">
      {LINKS.map((l) => {
        // Namespace graphs live under /namespaces/…/graph; keep "Graph" lit there too.
        const active = l.href === "/" ? pathname === "/" : pathname.startsWith(l.href) || (l.href === "/graph" && pathname.endsWith("/graph"));
        return (
          <Link
            key={l.href}
            href={l.href}
            aria-current={active ? "page" : undefined}
            className={`relative rounded-md px-1.5 py-1 transition-colors sm:px-2 hover:text-foreground ${active ? "text-foreground after:absolute after:inset-x-2 after:-bottom-[13px] after:h-0.5 after:rounded-full after:bg-foreground" : "text-muted-foreground"}`}
          >
            {l.label}
          </Link>
        );
      })}
      <PracticeLink active={pathname.startsWith("/review")} languageMode={languageMode} />
    </nav>
  );
}
