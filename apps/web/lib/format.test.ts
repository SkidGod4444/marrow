import { describe, expect, it } from "vitest";
import { fmtMinutes, fmtTokens, fmtUsd } from "./format";

describe("format", () => {
  it("money and tokens", () => {
    expect(fmtUsd(0.0891)).toBe("$0.09");
    expect(fmtUsd(0.001)).toBe("<$0.01");
    expect(fmtUsd(0)).toBe("$0.00");
    expect(fmtTokens(52_310)).toBe("52k");
    expect(fmtTokens(1_250_000)).toBe("1.3M");
    expect(fmtTokens(640)).toBe("640");
    expect(fmtMinutes(649)).toBe("10.8 min");
    expect(fmtMinutes(30)).toBe("30 s");
  });
});
