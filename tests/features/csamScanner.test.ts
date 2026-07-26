import { describe, it, expect } from "vitest";
import {
  summarizeBioMatch,
  enqueueUrgentBioCheck,
  dequeueUrgentBioCheck,
  isBioCheckStale,
} from "../../src/features/csamDetection/scanner";
import { BioResult } from "../../src/features/csamDetection/matcher";
import { CSAM_URGENT_COOLDOWN_MS } from "../../src/config/constants";

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

describe("urgent bio-check queue", () => {
  it("returns undefined when nothing is queued", () => {
    expect(dequeueUrgentBioCheck()).toBeUndefined();
  });

  it("dequeues what was enqueued", () => {
    enqueueUrgentBioCheck(910001, -100);
    expect(dequeueUrgentBioCheck()).toEqual({ userId: 910001, chatId: -100 });
    expect(dequeueUrgentBioCheck()).toBeUndefined();
  });

  it("is FIFO across distinct users", () => {
    enqueueUrgentBioCheck(910002, -100);
    enqueueUrgentBioCheck(910003, -100);
    expect(dequeueUrgentBioCheck()).toEqual({ userId: 910002, chatId: -100 });
    expect(dequeueUrgentBioCheck()).toEqual({ userId: 910003, chatId: -100 });
  });

  it("dedups repeat enqueues of the same user (chatty user in one chat)", () => {
    enqueueUrgentBioCheck(910004, -100);
    enqueueUrgentBioCheck(910004, -100);
    enqueueUrgentBioCheck(910004, -100);
    expect(dequeueUrgentBioCheck()).toEqual({ userId: 910004, chatId: -100 });
    expect(dequeueUrgentBioCheck()).toBeUndefined();
  });
});

describe("isBioCheckStale", () => {
  const now = new Date("2026-07-26T12:00:00Z");

  it("is stale when never checked", () => {
    expect(isBioCheckStale(undefined, now)).toBe(true);
  });

  it("is stale once older than the cooldown", () => {
    const lastChecked = new Date(now.getTime() - CSAM_URGENT_COOLDOWN_MS - 1);
    expect(isBioCheckStale(lastChecked, now)).toBe(true);
  });

  it("is NOT stale within the cooldown window", () => {
    const lastChecked = new Date(now.getTime() - CSAM_URGENT_COOLDOWN_MS + 1);
    expect(isBioCheckStale(lastChecked, now)).toBe(false);
  });

  it("is NOT stale for a just-now check", () => {
    expect(isBioCheckStale(now, now)).toBe(false);
  });
});
