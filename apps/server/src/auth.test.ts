import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { InProcessQueue, testEnv } from "@marrow/core";
import { createApp } from "./app.ts";
import { createAuth } from "./auth.ts";

// Owner login: first sign-up creates the owner, later sign-ups are refused, sessions ride on cookies through /api/auth.
describe("owner login (Better Auth)", () => {
  let env: Awaited<ReturnType<typeof testEnv>>;
  let app: ReturnType<typeof createApp>;
  const WEB = "http://localhost:3000";
  beforeEach(async () => {
    env = await testEnv();
    const config = { ...env.config, MARROW_API_KEY: "secret", MARROW_WEB_URL: WEB };
    const auth = createAuth(env.db, config);
    app = createApp({ ...env, config, queue: new InProcessQueue(), auth });
  });
  afterEach(async () => {
    await env.close();
  });

  const post = (path: string, body: unknown, cookie = "") =>
    app.request(path, { method: "POST", headers: { "content-type": "application/json", origin: WEB, ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) });
  const cookieOf = (res: Response) => (res.headers.get("set-cookie") ?? "").split(",").map((c) => c.split(";")[0]!.trim()).filter((c) => c.includes("session_token")).join("; ");

  it("status is public; sign-up works once; second sign-up is refused; sign-in yields a session", async () => {
    const before = await app.request("/auth/status");
    expect(before.status).toBe(200);
    expect(await before.json()).toEqual({ enabled: true, has_owner: false });

    const up = await post("/api/auth/sign-up/email", { email: "owner@example.com", password: "correct horse", name: "Owner" });
    expect(up.status).toBe(200);
    const cookie = cookieOf(up);
    expect(cookie).toContain("session_token");
    expect(await (await app.request("/auth/status")).json()).toEqual({ enabled: true, has_owner: true });

    const again = await post("/api/auth/sign-up/email", { email: "intruder@example.com", password: "letmein12345", name: "X" });
    expect(again.status).toBeGreaterThanOrEqual(400);
    expect(JSON.stringify(await again.json())).toMatch(/single-owner|already exists/i);

    const session = await app.request("/api/auth/get-session", { headers: { cookie } });
    expect(session.status).toBe(200);
    const body = (await session.json()) as { user?: { email: string } } | null;
    expect(body?.user?.email).toBe("owner@example.com");

    const bad = await post("/api/auth/sign-in/email", { email: "owner@example.com", password: "wrong password" });
    expect(bad.status).toBeGreaterThanOrEqual(400);
    const good = await post("/api/auth/sign-in/email", { email: "owner@example.com", password: "correct horse" });
    expect(good.status).toBe(200);
    expect(cookieOf(good)).toContain("session_token");

    const out = await post("/api/auth/sign-out", {}, cookie);
    expect(out.status).toBe(200);
    const gone = await app.request("/api/auth/get-session", { headers: { cookie } });
    expect(await gone.json()).toBeNull();
  });

  it("API routes still need the API key; auth routes do not", async () => {
    expect((await app.request("/namespaces")).status).toBe(401);
    expect((await app.request("/api/auth/get-session")).status).toBe(200);
  });
});
