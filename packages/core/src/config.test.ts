import { describe, expect, it } from "vitest";
import { loadConfig, normalizeDatabaseUrl } from "./config.ts";

describe("normalizeDatabaseUrl", () => {
  it("percent-encodes passwords with URL-reserved characters (RDS auto-generated)", () => {
    const raw = "postgres://marrow:RK)QV7BfFqCx<0d?~J8O_(:YtP3M@db.example.rds.amazonaws.com:5432/postgres";
    const out = normalizeDatabaseUrl(raw);
    expect(out).toBe("postgres://marrow:RK)QV7BfFqCx%3C0d%3F~J8O_(%3AYtP3M@db.example.rds.amazonaws.com:5432/postgres");
    const u = new URL(out);
    expect(decodeURIComponent(u.password)).toBe("RK)QV7BfFqCx<0d?~J8O_(:YtP3M");
    expect(u.hostname).toBe("db.example.rds.amazonaws.com");
  });

  it("leaves plain and already-encoded URLs alone", () => {
    expect(normalizeDatabaseUrl("postgres://marrow:marrow@localhost:5432/marrow")).toBe("postgres://marrow:marrow@localhost:5432/marrow");
    const enc = "postgres://u:p%3Fw@h/db";
    expect(normalizeDatabaseUrl(enc)).toBe(enc);
    expect(normalizeDatabaseUrl("postgres://h/db")).toBe("postgres://h/db");
  });

  it("applies when loading config", () => {
    expect(loadConfig({ DATABASE_URL: "postgres://u:a?b@h/db" }).DATABASE_URL).toBe("postgres://u:a%3Fb@h/db");
  });
});
