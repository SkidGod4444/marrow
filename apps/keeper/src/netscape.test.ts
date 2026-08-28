import { describe, expect, it } from "vitest";
import { isYoutubeCookie, parseNetscape, toNetscape } from "./netscape.ts";

describe("netscape cookie jar", () => {
  const text = [
    "# Netscape HTTP Cookie File",
    ".youtube.com\tTRUE\t/\tTRUE\t1790000000\tSID\tabc",
    "#HttpOnly_.youtube.com\tTRUE\t/\tTRUE\t1790000000\tLOGIN_INFO\txyz",
    "www.youtube.com\tFALSE\t/\tFALSE\t0\tYSC\tsession",
    "bad line",
    "",
  ].join("\n");

  it("parses browser exports, including httpOnly and session cookies", () => {
    const c = parseNetscape(text);
    expect(c).toHaveLength(3);
    expect(c[0]).toMatchObject({ name: "SID", value: "abc", domain: ".youtube.com", secure: true, httpOnly: false, expires: 1790000000 });
    expect(c[1]).toMatchObject({ name: "LOGIN_INFO", httpOnly: true, domain: ".youtube.com" });
    expect(c[2]).toMatchObject({ name: "YSC", expires: -1, secure: false, domain: "www.youtube.com" });
  });

  it("round-trips", () => {
    const once = parseNetscape(text);
    const again = parseNetscape(toNetscape(once));
    expect(again).toEqual(once);
    expect(toNetscape(once)).toContain("#HttpOnly_.youtube.com\tTRUE\t/\tTRUE\t1790000000\tLOGIN_INFO\txyz");
    expect(toNetscape(once)).toContain("www.youtube.com\tFALSE\t/\tFALSE\t0\tYSC\tsession");
  });

  it("keeps only YouTube and Google cookies", () => {
    expect(["youtube.com", ".youtube.com", "accounts.google.com", ".google.com", "#HttpOnly_.youtube.com"].every(isYoutubeCookie)).toBe(true);
    expect(["example.com", ".googleapis.com", "notyoutube.com"].some(isYoutubeCookie)).toBe(false);
  });
});
