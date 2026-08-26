"use client";

import { Check, Copy, Download, Link2, Printer } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/** Share/export controls for the text version: copy markdown, download .md / .txt, print to PDF, copy the link. */
export function ReadToolbar({ itemId, title }: { itemId: string; title: string }) {
  const [copied, setCopied] = useState<"md" | "link" | null>(null);
  const md = `/api/marrow/items/${itemId}/export.md?transcript=1`;
  const txt = `/api/marrow/items/${itemId}/export.txt`;
  const safe = (title || itemId).replace(/[^\w.-]+/g, "-").slice(0, 60);

  const copyMarkdown = async () => {
    try {
      const res = await fetch(md);
      if (!res.ok) throw new Error(res.statusText);
      await navigator.clipboard.writeText(await res.text());
      setCopied("md");
      toast.success("Markdown copied");
      setTimeout(() => setCopied(null), 1500);
    } catch (err) {
      toast.error("Couldn't copy", { description: (err as Error).message });
    }
  };
  const copyLink = async () => {
    await navigator.clipboard.writeText(window.location.href);
    setCopied("link");
    toast.success("Link copied");
    setTimeout(() => setCopied(null), 1500);
  };

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Tooltip>
        <TooltipTrigger render={<Button variant="outline" size="sm" onClick={() => void copyMarkdown()} />}>
          {copied === "md" ? <Check /> : <Copy />}
          Copy markdown
        </TooltipTrigger>
        <TooltipContent>Summary, takeaways and the dialogue with timestamp links</TooltipContent>
      </Tooltip>
      <Button variant="outline" size="sm" nativeButton={false} render={<a href={md} download={`${safe}.md`} />}>
        <Download />
        .md
      </Button>
      <Button variant="outline" size="sm" nativeButton={false} render={<a href={txt} download={`${safe}.txt`} />}>
        <Download />
        .txt
      </Button>
      <Tooltip>
        <TooltipTrigger render={<Button variant="outline" size="sm" onClick={() => window.print()} />}>
          <Printer />
          Print
        </TooltipTrigger>
        <TooltipContent>Print, or save as PDF</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger render={<Button variant="outline" size="sm" onClick={() => void copyLink()} />}>
          {copied === "link" ? <Check /> : <Link2 />}
          Share
        </TooltipTrigger>
        <TooltipContent>Copy the link to this page</TooltipContent>
      </Tooltip>
    </div>
  );
}
