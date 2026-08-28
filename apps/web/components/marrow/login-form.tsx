"use client";

import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { authClient } from "@/lib/auth-client";

/** Email + password sign-in / sign-up. A new account starts with its own personal workspace. */
export function LoginForm({ mode, next }: { mode: "sign-in" | "sign-up"; next: string }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const signup = mode === "sign-up";

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = signup ? await authClient.signUp.email({ name: name.trim() || email.split("@")[0]!, email: email.trim(), password }) : await authClient.signIn.email({ email: email.trim(), password });
      if (res.error) {
        const msg = res.error.message ?? "";
        setError(signup ? (/exist/i.test(msg) ? "There is already an account with that email — sign in instead." : msg || "Couldn't create the account.") : /invalid|not found|password/i.test(msg) ? "Wrong email or password." : msg || "Couldn't sign in.");
        return;
      }
      window.location.assign(next);
    } catch {
      setError("Couldn't reach the server. Try again in a moment.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4" aria-describedby={error ? "login-error" : undefined}>
      <div className="space-y-1">
        <h1 className="reading text-[24px] font-semibold tracking-tight">{signup ? "Create your account" : "Sign in"}</h1>
        <p className="text-sm text-muted-foreground">{signup ? "You get a personal workspace right away; invite others or join theirs later." : "Your inbox, library and graph are behind this door."}</p>
      </div>
      {signup && <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" autoComplete="name" aria-label="Name" autoFocus />}
      <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" autoComplete="email" required aria-label="Email" autoFocus={!signup} />
      <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder={signup ? "Password (8+ characters)" : "Password"} autoComplete={signup ? "new-password" : "current-password"} required minLength={8} aria-label="Password" />
      {error && (
        <p id="login-error" role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <Button type="submit" className="w-full" disabled={busy || !email.trim() || password.length < 8}>
        {busy ? (signup ? "Creating…" : "Signing in…") : signup ? "Create account" : "Sign in"}
      </Button>
      <p className="text-center text-sm text-muted-foreground">
        {signup ? "Already have an account? " : "New here? "}
        <Link href={signup ? `/login?next=${encodeURIComponent(next)}` : `/signup?next=${encodeURIComponent(next)}`} className="underline underline-offset-[3px] hover:text-foreground">
          {signup ? "Sign in" : "Create an account"}
        </Link>
      </p>
    </form>
  );
}
