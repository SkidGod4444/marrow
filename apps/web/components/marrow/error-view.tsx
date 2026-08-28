"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { startTransition, useEffect } from "react";
import { Button } from "@/components/ui/button";

/** Route error boundary — plain language, a way back, and a retry that re-fetches the page. Details go to the console. */
export function ErrorView({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const router = useRouter();
  useEffect(() => {
    console.error(error);
  }, [error]);
  const retry = () =>
    startTransition(() => {
      router.refresh(); // re-run the server side (the API may be back now)
      reset();
    });
  return (
    <div className="mx-auto max-w-xl space-y-4 py-16">
      <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">Hmm</p>
      <h1 className="reading text-[26px] font-semibold tracking-tight">This page couldn&apos;t load</h1>
      <p className="reading text-[16px] leading-relaxed text-foreground/85">The server didn&apos;t answer just now — it may be restarting after an update. Give it a moment and try again.</p>
      <div className="flex gap-2">
        <Button onClick={retry}>Try again</Button>
        <Button variant="outline" nativeButton={false} render={<Link href="/" />}>
          Go to the inbox
        </Button>
      </div>
    </div>
  );
}
