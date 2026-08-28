import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { InProcessQueue, createNamespace, testEnv } from "@marrow/core";
import { createApp } from "./app.ts";
import { createAuth } from "./auth.ts";
import { permissionsOf, roleCan } from "./auth.ts";

// Multi-tenant accounts: open sign-up, a personal workspace per user, shared workspaces with roles, per-user API keys
// bound to a workspace, and every data route confined to the caller's workspace and role.
describe("accounts, workspaces, roles (Better Auth)", () => {
  let env: Awaited<ReturnType<typeof testEnv>>;
  let app: ReturnType<typeof createApp>;
  let auth: ReturnType<typeof createAuth>;
  let queue: InProcessQueue;
  const WEB = "http://localhost:3000";
  beforeEach(async () => {
    env = await testEnv();
    const config = { ...env.config, MARROW_API_KEY: "instance-key", MARROW_WEB_URL: WEB };
    auth = createAuth(env.db, config);
    queue = new InProcessQueue();
    await queue.start(async () => undefined); // jobs are accepted, not run
    app = createApp({ ...env, config, queue, auth });
  });
  afterEach(async () => {
    await queue.stop();
    await env.close();
  });

  const json = (path: string, init: RequestInit & { cookie?: string; key?: string } = {}) =>
    app.request(path, {
      ...init,
      headers: { "content-type": "application/json", origin: WEB, ...(init.cookie ? { cookie: init.cookie } : {}), ...(init.key ? { "x-api-key": init.key } : {}), ...init.headers },
    });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type Json = Record<string, any>;
  const body = async (res: Response): Promise<Json> => (await res.json()) as Json;
  const cookieOf = (res: Response) => (res.headers.get("set-cookie") ?? "").split(",").map((c) => c.split(";")[0]!.trim()).filter((c) => c.includes("session_token")).join("; ");
  const signUp = async (email: string, name: string) => {
    const res = await json("/api/auth/sign-up/email", { method: "POST", body: JSON.stringify({ email, password: "correct horse battery", name }) });
    expect(res.status).toBe(200);
    return cookieOf(res);
  };

  it("the permission matrix", () => {
    expect(roleCan("viewer", "item", "read")).toBe(true);
    expect(roleCan("viewer", "item", "add")).toBe(false);
    expect(roleCan("member", "item", "add")).toBe(true);
    expect(roleCan("member", "namespace", "create")).toBe(false);
    expect(roleCan("admin", "namespace", "create")).toBe(true);
    expect(roleCan("admin", "namespace", "delete")).toBe(true);
    expect(roleCan("owner", "namespace", "delete")).toBe(true);
    expect(permissionsOf("viewer")).toEqual(expect.arrayContaining(["namespace:read", "item:read", "practice:use"]));
    expect(permissionsOf("viewer")).not.toContain("chat:use");
  });

  it("sign-up is open, every user gets a personal workspace, sessions land in it", async () => {
    const ada = await signUp("ada@example.com", "Ada");
    const bob = await signUp("bob@example.com", "Bob");
    const me = await body(await json("/me", { cookie: ada }));
    expect(me.user.email).toBe("ada@example.com");
    expect(me.organizations).toHaveLength(1);
    expect(me.organizations[0]).toMatchObject({ role: "owner", name: "Ada's workspace" });
    expect(me.active.id).toBe(me.organizations[0].id);
    expect(me.permissions).toContain("namespace:create");
    const meBob = await body(await json("/me", { cookie: bob }));
    expect(meBob.organizations[0].id).not.toBe(me.organizations[0].id);
  });

  it("data is confined to the active workspace; members and viewers get their roles' permissions", async () => {
    const ada = await signUp("ada@example.com", "Ada");
    const bob = await signUp("bob@example.com", "Bob");
    const vic = await signUp("vic@example.com", "Vic");
    // Ada creates a namespace in her workspace; Bob can't see it.
    const created = await json("/namespaces", { method: "POST", cookie: ada, body: JSON.stringify({ name: "robotics" }) });
    expect(created.status).toBe(201);
    expect((await body(await json("/namespaces", { cookie: ada }))).namespaces.map((n: { name: string }) => n.name)).toEqual(["robotics"]);
    expect((await body(await json("/namespaces", { cookie: bob }))).namespaces).toEqual([]);
    expect((await json("/items?namespace=robotics", { cookie: bob })).status).toBe(404);
    // Bob can have a namespace with the same name in his own workspace.
    expect((await json("/namespaces", { method: "POST", cookie: bob, body: JSON.stringify({ name: "robotics" }) })).status).toBe(201);

    // Ada invites Bob as a member and Vic as a viewer (server-side add — the UI does this through invitations).
    const me = await body(await json("/me", { cookie: ada }));
    const org = me.active.id as string;
    const bobId = (await body(await json("/me", { cookie: bob }))).user.id as string;
    const vicId = (await body(await json("/me", { cookie: vic }))).user.id as string;
    await auth.api.addMember({ body: { organizationId: org, userId: bobId, role: "member" } });
    await auth.api.addMember({ body: { organizationId: org, userId: vicId, role: "viewer" } });
    // Switching workspace: the x-marrow-org header (the web app uses the session's active workspace instead).
    const asBobInAda = { cookie: bob, headers: { "x-marrow-org": org } };
    const asVicInAda = { cookie: vic, headers: { "x-marrow-org": org } };
    expect((await body(await json("/namespaces", asBobInAda))).namespaces.map((n: { name: string }) => n.name)).toEqual(["robotics"]);
    // member may add items but not create namespaces
    const ing = await json("/ingest", { method: "POST", ...asBobInAda, body: JSON.stringify({ namespace: "robotics", url: "https://www.youtube.com/watch?v=abc" }) });
    expect([ing.status, await ing.text()]).toMatchObject([202, expect.any(String)]);
    expect((await json("/namespaces", { method: "POST", ...asBobInAda, body: JSON.stringify({ name: "more" }) })).status).toBe(403);
    // viewer may read but not add, chat, or follow
    expect((await json("/items?namespace=robotics", asVicInAda)).status).toBe(200);
    expect((await json("/ingest", { method: "POST", ...asVicInAda, body: JSON.stringify({ namespace: "robotics", url: "https://www.youtube.com/watch?v=xyz" }) })).status).toBe(403);
    expect((await json("/sources", { method: "POST", ...asVicInAda, body: JSON.stringify({ namespace: "robotics", url: "https://www.youtube.com/playlist?list=PL1" }) })).status).toBe(403);
    // a stranger's header is ignored: not a member → no workspace → nothing
    const eve = await signUp("eve@example.com", "Eve");
    expect((await body(await json("/namespaces", { cookie: eve, headers: { "x-marrow-org": org } }))).namespaces).toEqual([]);
  });

  it("per-user API keys are bound to a workspace and carry the role; the instance key names its workspace", async () => {
    const ada = await signUp("ada@example.com", "Ada");
    const me = await body(await json("/me", { cookie: ada }));
    const org = me.active.id as string;
    await json("/namespaces", { method: "POST", cookie: ada, body: JSON.stringify({ name: "robotics" }) });
    const created = await json("/api/auth/api-key/create", { method: "POST", cookie: ada, body: JSON.stringify({ name: "claude code", metadata: { organizationId: org } }) });
    expect(created.status).toBe(200);
    const { key } = (await created.json()) as { key: string };
    expect(key.startsWith("mrw_")).toBe(true);
    const viaKey = await body(await json("/me", { key }));
    expect(viaKey.user.via).toBe("apikey");
    expect(viaKey.active.id).toBe(org);
    expect(viaKey.active.role).toBe("owner");
    expect((await body(await json("/namespaces", { key }))).namespaces.map((n: { name: string }) => n.name)).toEqual(["robotics"]);
    expect((await json("/namespaces", { key: "mrw_not_a_key" })).status).toBe(401);
    expect((await json("/namespaces")).status).toBe(401);
    // instance key: operator, must say which workspace
    const inst = await body(await json("/namespaces", { key: "instance-key", headers: { "x-marrow-org": org } }));
    expect(inst.namespaces.map((n: { name: string }) => n.name)).toEqual(["robotics"]);
  });

  it("the first workspace adopts namespaces created before multi-tenancy", async () => {
    await createNamespace(env.db, { name: "legacy" });
    const ada = await signUp("ada@example.com", "Ada");
    expect((await body(await json("/namespaces", { cookie: ada }))).namespaces.map((n: { name: string }) => n.name)).toEqual(["legacy"]);
  });
});
