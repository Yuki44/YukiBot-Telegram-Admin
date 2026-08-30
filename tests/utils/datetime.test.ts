import { describe, it, expect } from "vitest";
import { formatMadridDateTime, formatMadridShortDate } from "../../src/utils/datetime";

describe("Madrid date formatting (server runs in UTC)", () => {
  it("shows summer time as UTC+2 (CEST) — the reported 2h-off bug", () => {
    // 10:26 UTC → 12:26 in Madrid.
    expect(formatMadridDateTime(new Date("2026-08-30T10:26:05Z"))).toBe(
      "30 de Agosto 2026 a las 12:26:05"
    );
  });

  it("shows winter time as UTC+1 (CET)", () => {
    // 10:00 UTC → 11:00 in Madrid.
    expect(formatMadridDateTime(new Date("2026-01-15T10:00:00Z"))).toBe(
      "15 de Enero 2026 a las 11:00:00"
    );
  });

  it("rolls the short date over when Madrid is already the next day", () => {
    // 23:30 UTC in summer → 01:30 the next day in Madrid.
    expect(formatMadridShortDate(new Date("2026-08-30T23:30:00Z"))).toBe("31/08/2026");
  });
});
