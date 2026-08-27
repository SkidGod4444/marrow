import { describe, expect, it } from "vitest";
import { databaseSsl } from "./index.ts";

describe("databaseSsl", () => {
  it("stays plain for local and compose hosts", () => {
    expect(databaseSsl("postgres://marrow:marrow@localhost:5432/marrow")).toBe(false);
    expect(databaseSsl("postgres://marrow:marrow@db:5432/marrow")).toBe(false);
    expect(databaseSsl("postgres://u:p@127.0.0.1/x")).toBe(false);
  });
  it("encrypts for remote hosts, verifying when a CA bundle exists", () => {
    const rds = "postgres://marrow:p@marrow.abc.ap-south-1.rds.amazonaws.com:5432/postgres";
    expect(databaseSsl(rds)).toEqual({ rejectUnauthorized: false }); // no CA file in the test env
    expect(databaseSsl(rds, { mode: "require" })).toEqual({ rejectUnauthorized: false });
    expect(databaseSsl(rds, { mode: "off" })).toBe(false);
    expect(databaseSsl(`${rds}?sslmode=disable`)).toBe(false);
    expect(databaseSsl(rds, { mode: "verify-full" })).toEqual({ rejectUnauthorized: true });
  });
  it("uses the CA bundle when present", () => {
    const rds = "postgres://u:p@x.rds.amazonaws.com/db";
    const withCa = databaseSsl(rds, { caPath: `${process.cwd()}/package.json` }); // any readable file stands in for the bundle
    expect(withCa).toMatchObject({ rejectUnauthorized: true });
    expect((withCa as { ca?: string }).ca).toContain("marrow");
  });
});
