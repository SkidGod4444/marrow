import { mkdirSync } from "node:fs";
import { request } from "@playwright/test";

// Sign in as the fake owner once and save the cookies; every test starts signed in (auth.spec.ts opts out).
export default async function globalSetup() {
  const base = `http://localhost:${process.env.E2E_WEB_PORT ?? 3100}`;
  const ctx = await request.newContext({ baseURL: base });
  const res = await ctx.post("/api/auth/sign-in/email", { data: { email: "owner@marrow.local", password: "marrow-owner" }, headers: { origin: base } });
  if (!res.ok()) throw new Error(`sign-in failed: ${res.status()} ${await res.text()}`);
  mkdirSync("e2e/.auth", { recursive: true });
  await ctx.storageState({ path: "e2e/.auth/owner.json" });
  await ctx.dispose();
}
