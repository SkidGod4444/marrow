import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { inspectJar, installCookieJar, parseNetscape, toNetscape } from "./youtube-cookies.ts";

const far = Math.floor(Date.now() / 1000) + 86_400 * 300;
const signedIn = [
  "# Netscape HTTP Cookie File",
  `.youtube.com\tTRUE\t/\tTRUE\t${far}\tSID\tabc`,
  `#HttpOnly_.youtube.com\tTRUE\t/\tTRUE\t${far}\tHSID\tdef`,
  `#HttpOnly_.youtube.com\tTRUE\t/\tTRUE\t${far}\tSSID\tghi`,
  `.youtube.com\tTRUE\t/\tFALSE\t${far}\tAPISID\tjkl`,
  `.youtube.com\tTRUE\t/\tTRUE\t${far}\tSAPISID\tmno`,
  `.google.com\tTRUE\t/\tTRUE\t${far}\t__Secure-3PSID\tpqr`,
  `.example.com\tTRUE\t/\tFALSE\t${far}\ttracker\tdrop-me`,
].join("\n");

describe("YouTube cookie jars from the browser", () => {
  it("parses and re-serialises Netscape lines, httpOnly prefix included", () => {
    const c = parseNetscape(signedIn);
    expect(c).toHaveLength(7);
    expect(c[1]).toMatchObject({ domain: ".youtube.com", httpOnly: true, name: "HSID", secure: true, includeSubdomains: true });
    expect(toNetscape(c)).toContain(`#HttpOnly_.youtube.com\tTRUE\t/\tTRUE\t${far}\tHSID\tdef`);
  });

  it("keeps only YouTube/Google cookies and insists on a signed-in session, in plain words", () => {
    const ok = inspectJar(signedIn);
    expect(ok.ok && ok.cookies.map((c) => c.name)).toEqual(["SID", "HSID", "SSID", "APISID", "SAPISID", "__Secure-3PSID"]);
    expect(inspectJar("")).toMatchObject({ ok: false, error: /no cookies found/ });
    expect(inspectJar(`.example.com\tTRUE\t/\tFALSE\t${far}\ta\tb`)).toMatchObject({ ok: false, error: /no YouTube or Google cookies/ });
    expect(inspectJar(`.youtube.com\tTRUE\t/\tFALSE\t${far}\tVISITOR_INFO1_LIVE\tx`)).toMatchObject({ ok: false, error: /not a signed-in YouTube session \(missing SID/ });
    expect(inspectJar(signedIn.replace(`${far}\tSID`, `1\tSID`))).toMatchObject({ ok: false, error: /expired/ });
  });

  it("installs the jar atomically at the configured path and refuses without one", async () => {
    await expect(installCookieJar(undefined, signedIn)).rejects.toThrow(/no cookie file configured/);
    const dir = await mkdtemp(join(tmpdir(), "marrow-jar-"));
    const path = join(dir, "secrets", "cookies.txt");
    const r = await installCookieJar(path, signedIn);
    expect(r).toEqual({ cookies: 6, path });
    const written = await readFile(path, "utf8");
    expect(written).toContain("SAPISID\tmno");
    expect(written).not.toContain("drop-me");
  });
});
