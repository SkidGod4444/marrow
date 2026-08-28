"use client";

import { LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { authClient } from "@/lib/auth-client";

/** Who is signed in + sign out. Sits at the right end of the header. */
export function UserMenu({ email, name }: { email: string; name: string }) {
  const initial = (name || email).trim().charAt(0).toUpperCase() || "?";
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="outline" size="icon-sm" className="ml-auto font-mono text-[12px]" aria-label={`Signed in as ${email}`} />}>{initial}</DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-52 font-sans text-[13px]">
        {/* base-ui requires labels inside a group */}
        <DropdownMenuGroup>
          <DropdownMenuLabel className="font-normal">
            <span className="block font-medium">{name}</span>
            <span className="block font-mono text-[11px] text-muted-foreground">{email}</span>
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={() =>
            void authClient.signOut().finally(() => {
              window.location.assign("/login");
            })
          }
        >
          <LogOut />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
