"use client";

import Link from "next/link";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";

/** Route error boundary — plain language, a way back, and a retry. Details go to the console, not the screen. */
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <div className="mx-auto max-w-xl space-y-4 py-16">
      <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">Hmm</p>
      <h1 className="reading text-[26px] font-semibold tracking-tight">This page couldn&apos;t load</h1>
      <p className="reading text-[16px] leading-relaxed text-foreground/85">Something went wrong on our side. Give it a moment and try again.</p>
      <div className="flex gap-2">
        <Button onClick={reset}>Try again</Button>
        <Button variant="outline" nativeButton={false} render={<Link href="/" />}>
          Go to the inbox
        </Button>
      </div>
    </div>
  );
}
