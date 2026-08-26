import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="mx-auto max-w-xl space-y-4 py-16">
      <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">404</p>
      <h1 className="reading text-[26px] font-semibold tracking-tight">Nothing at this address</h1>
      <p className="reading text-[16px] leading-relaxed text-foreground/85">The item or namespace may have been removed, or the link is wrong.</p>
      <Button variant="outline" nativeButton={false} render={<Link href="/" />}>
        Back to the inbox
      </Button>
    </div>
  );
}
