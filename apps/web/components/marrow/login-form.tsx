"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { authClient } from "@/lib/auth-client";

/** Email + password. `create-owner` runs once — Marrow is single-owner, so sign-up closes after the first account. */
export function LoginForm({ mode, next }: { mode: "sign-in" | "create-owner"; next: string }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const creating = mode === "create-owner";

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = creating ? await authClient.signUp.email({ name: name.trim() || email.split("@")[0]!, email: email.trim(), password }) : await authClient.signIn.email({ email: email.trim(), password });
      if (res.error) {
        const msg = res.error.message ?? "";
        setError(creating ? msg || "Couldn't create the account." : /invalid|not found|password/i.test(msg) ? "Wrong email or password." : msg || "Couldn't sign in.");
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
        <h1 className="reading text-[24px] font-semibold tracking-tight">{creating ? "Create your account" : "Sign in"}</h1>
        <p className="text-sm text-muted-foreground">{creating ? "This is a private, single-owner instance. The first account becomes the owner; nobody else can sign up." : "Your research inbox, library and graph are behind this door."}</p>
      </div>
      {creating && <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" autoComplete="name" aria-label="Name" />}
      <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" autoComplete="email" required aria-label="Email" autoFocus />
      <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder={creating ? "Password (8+ characters)" : "Password"} autoComplete={creating ? "new-password" : "current-password"} required minLength={8} aria-label="Password" />
      {error && (
        <p id="login-error" role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <Button type="submit" className="w-full" disabled={busy || !email.trim() || password.length < 8}>
        {busy ? (creating ? "Creating…" : "Signing in…") : creating ? "Create account" : "Sign in"}
      </Button>
    </form>
  );
}
