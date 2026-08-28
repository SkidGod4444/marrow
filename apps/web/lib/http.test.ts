import { describe, expect, it } from "vitest";
import { ApiError, errorFor, fetchWithRetry, readJson } from "./http";

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const noSleep = async () => undefined;

describe("fetchWithRetry", () => {
  it("retries 502/503/504 on GET and returns the first good reply", async () => {
    const seen: number[] = [];
    let n = 0;
    const fetchImpl = (async () => {
      seen.push(++n);
      return n < 3 ? new Response("restarting", { status: 503 }) : json(200, { ok: true });
    }) as unknown as typeof fetch;
    const res = await fetchWithRetry("/x", {}, { fetchImpl, sleep: noSleep });
    expect(res.status).toBe(200);
    expect(seen).toEqual([1, 2, 3]);
  });
  it("gives up after the attempts and returns the last transient reply", async () => {
    const fetchImpl = (async () => new Response("", { status: 502 })) as unknown as typeof fetch;
    const res = await fetchWithRetry("/x", {}, { fetchImpl, sleep: noSleep, attempts: 2 });
    expect(res.status).toBe(502);
  });
  it("never retries a write (it may have gone through)", async () => {
    let n = 0;
    const fetchImpl = (async () => (++n, new Response("", { status: 503 }))) as unknown as typeof fetch;
    const res = await fetchWithRetry("/x", { method: "POST" }, { fetchImpl, sleep: noSleep });
    expect([res.status, n]).toEqual([503, 1]);
  });
  it("retries a dropped connection on GET, then rethrows", async () => {
    let n = 0;
    const fetchImpl = (async () => {
      n++;
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    await expect(fetchWithRetry("/x", {}, { fetchImpl, sleep: noSleep })).rejects.toThrow("fetch failed");
    expect(n).toBe(3);
  });
  it("does not retry ordinary errors", async () => {
    let n = 0;
    const fetchImpl = (async () => (++n, json(400, { error: "bad" }))) as unknown as typeof fetch;
    expect((await fetchWithRetry("/x", {}, { fetchImpl, sleep: noSleep })).status).toBe(400);
    expect(n).toBe(1);
  });
});

describe("reading replies", () => {
  it("a 2xx that is not JSON is an error, not {}", async () => {
    await expect(readJson(new Response("<html>cut off", { status: 200 }))).rejects.toBeInstanceOf(ApiError);
    await expect(readJson(new Response("", { status: 200 }))).rejects.toThrow(/incomplete reply/);
    expect(await readJson(json(200, { a: 1 }))).toEqual({ a: 1 });
  });
  it("keeps the server's own message, and speaks plainly otherwise", async () => {
    expect((await errorFor(json(400, { error: "a namespace called \"demo\" already exists" }))).message).toMatch(/already exists/);
    const gateway = await errorFor(new Response("<html>502 Bad Gateway</html>", { status: 502 }));
    expect([gateway.status, gateway.message]).toEqual([502, expect.stringMatching(/restarting/)]);
    expect((await errorFor(new Response("", { status: 401 }))).message).toBe("Sign in first.");
  });
});
