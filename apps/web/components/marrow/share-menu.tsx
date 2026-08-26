"use client";

import { Check, Copy, Download, ExternalLink, Link2, Printer, Share2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

/**
 * One Share control for both the Reader tab and the shared page: copy the shareable link (the text version of the
 * item, /items/<id>/read), open it, copy as markdown, download .md/.txt, print to PDF (on the shared page).
 */
export function ShareMenu({ itemId, title, onSharedPage = false, size = "sm" }: { itemId: string; title: string; onSharedPage?: boolean; size?: "sm" | "xs" }) {
  const [copied, setCopied] = useState<string | null>(null);
  const sharedPath = `/items/${itemId}/read`;
  const md = `/api/marrow/items/${itemId}/export.md?transcript=1`;
  const txt = `/api/marrow/items/${itemId}/export.txt`;
  const safe = (title || itemId).replace(/[^\w.-]+/g, "-").slice(0, 60);

  const flash = (what: string, message: string) => {
    setCopied(what);
    toast.success(message);
    setTimeout(() => setCopied(null), 1500);
  };
  const copyLink = async () => {
    await navigator.clipboard.writeText(`${window.location.origin}${sharedPath}`);
    flash("link", "Link copied");
  };
  const copyMarkdown = async () => {
    try {
      const res = await fetch(md);
      if (!res.ok) throw new Error(res.statusText);
      await navigator.clipboard.writeText(await res.text());
      flash("md", "Markdown copied");
    } catch {
      toast.error("Couldn't copy right now");
    }
  };
  const download = (href: string, name: string) => {
    const a = document.createElement("a");
    a.href = href;
    a.download = name;
    a.click();
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="outline" size={size} />}>
        {copied ? <Check /> : <Share2 />}
        Share
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[13rem]">
        <DropdownMenuItem onClick={() => void copyLink()}>
          <Link2 />
          Copy link
        </DropdownMenuItem>
        {!onSharedPage && (
          <DropdownMenuItem nativeButton={false} render={<Link href={sharedPath} />}>
            <ExternalLink />
            Open shared page
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => void copyMarkdown()}>
          <Copy />
          Copy as markdown
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => download(md, `${safe}.md`)}>
          <Download />
          Download .md
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => download(txt, `${safe}.txt`)}>
          <Download />
          Download .txt
        </DropdownMenuItem>
        {onSharedPage && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => window.print()}>
              <Printer />
              Print / save as PDF
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
