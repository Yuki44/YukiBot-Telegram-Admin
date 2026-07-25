import { describe, it, expect } from "vitest";
import { summarizeBioMatch } from "../../src/features/csamDetection/scanner";
import { BioResult } from "../../src/features/csamDetection/matcher";

describe("summarizeBioMatch", () => {
  it("joins handle + solicitation terms", () => {
    const r: BioResult = {
      verdict: "AUTO_BAN",
      handle: "nomax16",
      solicitation: ["ib", "cc"],
      negation: [],
    };
    expect(summarizeBioMatch(r)).toBe("nomax16 + ib, cc");
  });

  it("marks the handle-only (silence) case", () => {
    const r: BioResult = { verdict: "SILENCE", handle: "nomax16", solicitation: [], negation: [] };
    expect(summarizeBioMatch(r)).toContain("nomax16");
  });

  it("surfaces negation terms so a reviewer sees the ally signal", () => {
    const r: BioResult = {
      verdict: "SILENCE",
      handle: "nomax16",
      solicitation: [],
      negation: ["no cp", "report"],
    };
    const s = summarizeBioMatch(r);
    expect(s).toContain("nomax16");
    expect(s).toContain("no cp");
  });
});
