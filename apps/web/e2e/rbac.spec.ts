import { RUN, api, expect, readyItem, test } from "./helpers";
import { USERS, WORKSPACE, storageState } from "./users";

// Roles inside a workspace: viewer reads, member adds, owner/admin manage people and keys.

test.describe("viewer", () => {
  test.use({ storageState: storageState("viewer") });

  test("can read everything but change nothing: no add / skip / follow controls, and writes are refused", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("button", { name: `Workspace: ${WORKSPACE.name}` })).toBeVisible();
    await expect(page.getByRole("button", { name: /^skip$/i })).toHaveCount(0);
    await expect(page.getByRole("link", { name: /^chat$/i })).toHaveCount(0);

    await page.goto("/library");
    await expect(page.getByRole("heading", { name: "Library" })).toBeVisible();
    // Scope to the page body: while a streamed segment is being swapped in, React briefly keeps a hidden copy outside it.
    await expect(page.locator("#main").getByText(/adding is for members and up/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /^add( to .+)?$/i })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /follow a playlist/i })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /language mode/i })).toHaveCount(0);

    const it = await readyItem((i) => i.sourceType === "youtube_video");
    await page.goto(`/items/${it.id}`);
    await expect(page.getByRole("tab", { name: "Reader" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Chat" })).toHaveCount(0);

    // The server is the gate, not the UI.
    const archive = await page.request.post(`/api/marrow/items/${it.id}/archive`, { data: { archived: true } });
    expect(archive.status()).toBe(403);
    const ingest = await page.request.post("/api/marrow/ingest", { data: { namespace: "demo", url: "https://www.youtube.com/watch?v=viewer-cannot" } });
    expect(ingest.status()).toBe(403);

    await page.goto("/settings");
    await expect(page.getByText(USERS.owner.email)).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Email to invite" })).toHaveCount(0);
    await expect(page.getByRole("textbox", { name: "Key name" })).toHaveCount(0);
    await expect(page.getByText(/viewers can.t create api keys/i)).toBeVisible();
  });
});

test.describe("member", () => {
  test.use({ storageState: storageState("member") });

  test("can add and skip but not manage people", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("button", { name: /^skip$/i }).first()).toBeVisible();
    await page.goto("/library");
    await expect(page.getByRole("button", { name: /^add( to .+)?$/i })).toBeVisible();
    await page.goto("/settings");
    await expect(page.getByText(USERS.member.email)).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Email to invite" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^remove /i })).toHaveCount(0);
  });

  test("makes an API key that works for Claude Code and is bound to this workspace; revoking it shuts the door", async ({ page }) => {
    await page.goto("/settings#api-keys");
    await page.getByRole("textbox", { name: "Key name" }).fill(`Laptop ${RUN}`);
    await page.getByRole("button", { name: "Create key" }).click();
    await expect(page.getByText(/won.t be shown again/i)).toBeVisible();
    const key = (await page.locator("code", { hasText: /^mrw_/ }).first().textContent())?.trim();
    expect(key).toMatch(/^mrw_/);
    await expect(page.getByText(`Laptop ${RUN}`)).toBeVisible();

    const me = await api<{ user: { via: string; email: string }; active: { slug: string; role: string } }>("/me", { headers: { "x-api-key": key! } });
    expect(me.user.via).toBe("apikey");
    expect(me.user.email).toBe(USERS.member.email);
    expect(me.active.slug).toBe(WORKSPACE.slug);
    expect(me.active.role).toBe("member");
    const ns = await api<{ namespaces: Array<{ name: string }> }>("/namespaces", { headers: { "x-api-key": key! } });
    expect(ns.namespaces.map((n) => n.name)).toContain("demo");

    const row = page.getByRole("listitem").filter({ hasText: `Laptop ${RUN}` });
    await row.getByRole("button", { name: /revoke/i }).click();
    await expect(page.getByText("Key revoked")).toBeVisible();
    await expect(row).toHaveCount(0);
    const gone = await fetch(`${process.env.E2E_API_URL ?? "http://localhost:3101"}/me`, { headers: { "x-api-key": key! } });
    expect(gone.status).toBe(401);
  });
});

test.describe("owner", () => {
  test.use({ storageState: storageState("owner") });

  test("sees the roster with roles, invites someone by link, and the invitee joins as a member", async ({ page, browser }) => {
    await page.goto("/settings");
    for (const u of Object.values(USERS)) await expect(page.getByText(u.email)).toBeVisible();
    await expect(page.getByRole("combobox", { name: `Role of ${USERS.viewer.email}` })).toContainText(/viewer/i);
    await expect(page.getByRole("button", { name: `Remove ${USERS.owner.email}` })).toHaveCount(0); // never yourself

    const email = `invitee-${RUN}@example.com`;
    await page.getByRole("textbox", { name: "Email to invite" }).fill(email);
    await page.getByRole("button", { name: "Create invitation" }).click();
    await expect(page.getByText(/invitation created/i)).toBeVisible();
    const row = page.getByRole("listitem").filter({ hasText: email });
    await expect(row.getByRole("button", { name: "Copy link" })).toBeVisible();
    const full = (await (await page.request.get(`/api/auth/organization/get-full-organization?organizationSlug=${WORKSPACE.slug}`)).json()) as { invitations: Array<{ id: string; email: string; status: string }> };
    const inv = full.invitations.find((i) => i.email === email && i.status === "pending");
    expect(inv).toBeTruthy();

    // The invitee opens the link in a fresh browser: sign-in gate → create an account → accept → in the workspace.
    const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const p2 = await ctx.newPage();
    await p2.goto(`/invite/${inv!.id}`);
    await expect(p2).toHaveURL(/\/login\?next=%2Finvite%2F/);
    await p2.getByRole("link", { name: "Create an account" }).click();
    await p2.getByRole("textbox", { name: "Name" }).fill("Ivy Invitee");
    await p2.getByRole("textbox", { name: "Email" }).fill(email);
    await p2.getByRole("textbox", { name: "Password" }).fill("a-long-passphrase");
    await p2.getByRole("button", { name: "Create account" }).click();
    await expect(p2).toHaveURL(new RegExp(`/invite/${inv!.id}$`));
    await expect(p2.getByRole("heading", { name: new RegExp(WORKSPACE.name) })).toBeVisible();
    await p2.getByRole("button", { name: "Accept and join" }).click();
    await expect(p2).toHaveURL(/\/$/);
    await expect(p2.getByRole("button", { name: `Workspace: ${WORKSPACE.name}` })).toBeVisible();
    const me = (await (await p2.request.get("/api/marrow/me")).json()) as { organizations: Array<{ slug: string; role: string }> };
    expect(me.organizations.find((o) => o.slug === WORKSPACE.slug)?.role).toBe("member");
    await ctx.close();

    // …and the owner's roster now shows them.
    await page.reload();
    await expect(page.getByText(email)).toBeVisible();
    await expect(page.getByRole("combobox", { name: `Role of ${email}` })).toContainText(/member/i);
  });
});
