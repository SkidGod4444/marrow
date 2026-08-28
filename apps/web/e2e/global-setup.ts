import { mkdirSync } from "node:fs";
import { request } from "@playwright/test";
import { USERS, WORKSPACE } from "./users";

// Sign in the three seeded accounts once, point each at the Demo Lab workspace and save the cookies.
// Every test starts signed in as the owner; role specs switch storageState, auth.spec opts out entirely.
export default async function globalSetup() {
  const base = `http://localhost:${process.env.E2E_WEB_PORT ?? 3100}`;
  mkdirSync("e2e/.auth", { recursive: true });
  for (const [role, u] of Object.entries(USERS)) {
    const ctx = await request.newContext({ baseURL: base });
    const res = await ctx.post("/api/auth/sign-in/email", { data: { email: u.email, password: u.password }, headers: { origin: base } });
    if (!res.ok()) throw new Error(`sign-in as ${role} failed: ${res.status()} ${await res.text()}`);
    const active = await ctx.post("/api/auth/organization/set-active", { data: { organizationSlug: WORKSPACE.slug }, headers: { origin: base } });
    if (!active.ok()) throw new Error(`set-active as ${role} failed: ${active.status()} ${await active.text()}`);
    await ctx.storageState({ path: `e2e/.auth/${role}.json` });
    await ctx.dispose();
  }
}
