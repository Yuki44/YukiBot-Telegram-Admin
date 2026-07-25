import { describe, it, expect } from "vitest";
import {
  buildWatchConfig,
  DEFAULT_SOLICITATION,
  DEFAULT_NEGATION,
  DEFAULT_KEYWORDS,
} from "../../src/features/csamDetection/config";

describe("buildWatchConfig", () => {
  it("seeds handles from env, lowercased and @-stripped", () => {
    const cfg = buildWatchConfig(null, ["@Nomax16", "Foo"]);
    expect(cfg.handles).toContain("nomax16");
    expect(cfg.handles).toContain("foo");
  });

  it("merges env + stored handles and dedupes", () => {
    const cfg = buildWatchConfig({ handles: ["nomax16", "bar"] }, ["nomax16"]);
    expect(cfg.handles.filter((h) => h === "nomax16")).toHaveLength(1);
    expect(cfg.handles).toContain("bar");
  });

  it("includes built-in defaults for solicitation/negation/keywords", () => {
    const cfg = buildWatchConfig(null, []);
    for (const t of DEFAULT_SOLICITATION) expect(cfg.solicitation).toContain(t);
    for (const t of DEFAULT_NEGATION) expect(cfg.negation).toContain(t);
    for (const t of DEFAULT_KEYWORDS) expect(cfg.keywords).toContain(t);
  });

  it("layers stored terms on top of defaults and dedupes", () => {
    const cfg = buildWatchConfig({ solicitation: ["nueva venta", "IB"], negation: ["no cp"] }, []);
    expect(cfg.solicitation).toContain("nueva venta");
    // "ib" is already a default → must not duplicate after lowercasing
    expect(cfg.solicitation.filter((t) => t === "ib")).toHaveLength(1);
    expect(cfg.negation.filter((t) => t === "no cp")).toHaveLength(1);
  });

  it("tolerates null/undefined stored and empty env", () => {
    const cfg = buildWatchConfig(undefined);
    expect(cfg.handles).toEqual([]);
    expect(cfg.solicitation.length).toBeGreaterThan(0);
  });

  it("drops empty/whitespace-only entries", () => {
    const cfg = buildWatchConfig({ handles: ["  ", ""] }, ["  "]);
    expect(cfg.handles).toEqual([]);
  });
});
