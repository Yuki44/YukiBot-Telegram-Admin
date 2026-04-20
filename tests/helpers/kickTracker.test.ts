import { describe, it, expect, afterEach } from "vitest";
import { markKickInProgress, isKickInProgress, clearKick } from "../../src/bot/helpers/kickTracker";

describe("kickTracker", () => {
  afterEach(() => {
    clearKick(1, 100);
    clearKick(1, 200);
  });

  it("initially returns false", () => {
    expect(isKickInProgress(1, 100)).toBe(false);
  });

  it("returns true after markKickInProgress", () => {
    markKickInProgress(1, 100);
    expect(isKickInProgress(1, 100)).toBe(true);
  });

  it("does not mix different user/chat pairs", () => {
    markKickInProgress(1, 100);
    expect(isKickInProgress(1, 200)).toBe(false);
  });

  it("clearKick removes the entry", () => {
    markKickInProgress(1, 100);
    clearKick(1, 100);
    expect(isKickInProgress(1, 100)).toBe(false);
  });
});

