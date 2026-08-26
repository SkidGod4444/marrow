"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "Inbox" },
  { href: "/library", label: "Library" },
];

/** Primary nav with an explicit current-page state (Nielsen #1: visibility of system status). */
export function NavLinks() {
  const pathname = usePathname();
  return (
    <nav aria-label="Primary" className="flex items-center gap-1 text-[13px]">
      {LINKS.map((l) => {
        const active = l.href === "/" ? pathname === "/" : pathname.startsWith(l.href);
        return (
          <Link
            key={l.href}
            href={l.href}
            aria-current={active ? "page" : undefined}
            className={`relative rounded-md px-2 py-1 transition-colors hover:text-foreground ${active ? "text-foreground after:absolute after:inset-x-2 after:-bottom-[13px] after:h-0.5 after:rounded-full after:bg-foreground" : "text-muted-foreground"}`}
          >
            {l.label}
          </Link>
        );
      })}
    </nav>
  );
}
