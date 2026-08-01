import { describe, it, expect } from "vitest";
import {
  summarizeBioMatch,
  enqueueUrgentBioCheck,
  dequeueUrgentBioCheck,
  isBioCheckStale,
} from "../../src/features/csamDetection/scanner";
import { BioResult, evaluateBio } from "../../src/features/csamDetection/matcher";
import { buildWatchConfig } from "../../src/features/csamDetection/config";
import { CSAM_URGENT_COOLDOWN_MS, CSAM_SCAN_MIN_INTERVAL_MS } from "../../src/config/constants";

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

describe("rotation re-check window", () => {
  // Regression: joined clean, flipped the bio ~6h later, posted. The image was deleted
  // before the bot saw it, so the rotation was the only remaining trigger.
  it("re-checks a bio well within the lurk-then-flip window", () => {
    const joinCheck = new Date("2026-07-31T20:51:29Z");
    const postedAt = new Date("2026-08-01T03:32:00Z");
    const dueBefore = new Date(postedAt.getTime() - CSAM_SCAN_MIN_INTERVAL_MS);
    expect(joinCheck.getTime()).toBeLessThan(dueBefore.getTime());
  });

  it("keeps a floor so a tiny population is not re-fetched in a tight spin", () => {
    expect(CSAM_SCAN_MIN_INTERVAL_MS).toBeGreaterThanOrEqual(15 * 60 * 1000);
  });
});

describe("evaluateBio on the bio that was missed", () => {
  const config = buildWatchConfig(null, ["nomax16"]);

  it("auto-bans the real bio that went undetected", () => {
    const bio = "pls text to my main account @nomax16 - ae ib cc chính @nomax16";
    expect(evaluateBio(bio, config).verdict).toBe("AUTO_BAN");
  });

  it("leaves an unrelated bio alone", () => {
    expect(evaluateBio("just here for the memes", config).verdict).toBe("NONE");
  });
});
