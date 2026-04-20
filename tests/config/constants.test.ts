import { describe, it, expect } from "vitest";
import {
  MAX_WARNINGS,
  SILENCE_DURATION_S,
  SILENCE_DURATION_MS,
  KICK_TRACKER_TTL_MS,
  LEFT_WITH_WARNINGS_TTL_S,
} from "../../src/config/constants";

describe("constants", () => {
  it("MAX_WARNINGS is 3", () => {
    expect(MAX_WARNINGS).toBe(3);
  });

  it("SILENCE_DURATION_S is exactly 1 week in seconds", () => {
    expect(SILENCE_DURATION_S).toBe(7 * 24 * 60 * 60);
  });

  it("SILENCE_DURATION_MS equals SILENCE_DURATION_S * 1000", () => {
    expect(SILENCE_DURATION_MS).toBe(SILENCE_DURATION_S * 1000);
  });

  it("KICK_TRACKER_TTL_MS is 30 seconds", () => {
    expect(KICK_TRACKER_TTL_MS).toBe(30 * 1000);
  });

  it("LEFT_WITH_WARNINGS_TTL_S is 6 months in seconds", () => {
    expect(LEFT_WITH_WARNINGS_TTL_S).toBe(6 * 30 * 24 * 60 * 60);
  });
});

