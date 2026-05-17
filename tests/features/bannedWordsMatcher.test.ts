import { describe, it, expect } from "vitest";
import { findMatchingRule } from "../../src/features/bannedWordsEnforcement/matcher";
import { IBannedWord } from "../../src/types";

/** Minimal rule factory — findMatchingRule only reads word/exactMatch/scope/topicId. */
function rule(
  word: string,
  opts: { exactMatch?: boolean; scope?: "all" | "topic"; topicId?: number } = {}
): IBannedWord {
  return {
    word,
    exactMatch: opts.exactMatch ?? false,
    scope: opts.scope ?? "all",
    topicId: opts.topicId,
  } as unknown as IBannedWord;
}

function hit(word: string, text: string, exactMatch = false): boolean {
  return findMatchingRule([rule(word, { exactMatch })], text, undefined) !== null;
}

// Cyrillic look-alikes: с=U+0441 о=U+043E а=U+0430
const CYR = (s: string) =>
  s
    .replace(/c/g, String.fromCodePoint(0x0441))
    .replace(/o/g, String.fromCodePoint(0x043e))
    .replace(/a/g, String.fromCodePoint(0x0430));
const EMOJI_C = String.fromCodePoint(0x1f172); // 🅲 negative-squared C
const EMOJI_P = String.fromCodePoint(0x1f17f); // 🅿 negative-squared P
const VS16 = String.fromCodePoint(0xfe0f); // emoji variation selector

describe("findMatchingRule — whole-word default (box OFF) fixes the coca/cocacola bug", () => {
  it("matches the word as a standalone token", () => {
    expect(hit("coca", "toma coca ahora")).toBe(true);
    expect(hit("coca", "COCA")).toBe(true);
    expect(hit("coca", "compra cocá!")).toBe(true); // diacritic-stripped
    expect(hit("coca", "¿coca?")).toBe(true); // punctuation-adjacent
  });

  it("does NOT match when the word is only a substring", () => {
    expect(hit("coca", "cocacola")).toBe(false);
    expect(hit("coca", "un coco")).toBe(false);
    expect(hit("coca", "cocoa caliente")).toBe(false);
    expect(hit("coca", "cacao")).toBe(false);
  });

  it("does not match the leet disguise when the box is OFF", () => {
    expect(hit("coca", "c0c4")).toBe(false);
    expect(hit("cp", "c.p")).toBe(false);
  });

  it("supports multi-word phrases as whole phrases", () => {
    expect(hit("free money", "win free money now")).toBe(true);
    expect(hit("free money", "freemoney")).toBe(false);
  });
});

describe("findMatchingRule — fuzzy mode (box ON) detects disguises", () => {
  it("catches leet / symbol / padding variants", () => {
    expect(hit("coca", "c0c4", true)).toBe(true);
    expect(hit("coca", "coc4", true)).toBe(true);
    expect(hit("coca", "c0ca", true)).toBe(true);
    expect(hit("coca", "cooooca", true)).toBe(true);
  });

  it("catches intra-word separators", () => {
    expect(hit("cp", "manda un c.p porfa", true)).toBe(true);
    expect(hit("cp", "c-p", true)).toBe(true);
    expect(hit("cp", "c_p", true)).toBe(true);
    expect(hit("cp", "c. p", true)).toBe(true);
  });

  it("catches Cyrillic homoglyphs and letter-emojis", () => {
    expect(hit("coca", CYR("coca"), true)).toBe(true);
    expect(hit("coca", EMOJI_C + "oca", true)).toBe(true);
    expect(hit("cp", "c" + EMOJI_P + VS16, true)).toBe(true);
  });

  it("still respects word boundaries (no substring false positives)", () => {
    expect(hit("coca", "cocacola", true)).toBe(false);
    expect(hit("coca", "coco", true)).toBe(false);
    expect(hit("coca", "cocoa", true)).toBe(false);
    expect(hit("coca", "cacao", true)).toBe(false);
    expect(hit("coca", "xcocax", true)).toBe(false);
  });

  it("does not over-match the short 'cp' rule", () => {
    expect(hit("cp", "pc", true)).toBe(false); // order preserved
    expect(hit("cp", "capture", true)).toBe(false);
    expect(hit("cp", "scrap", true)).toBe(false);
  });

  it("legacy multi-word phrase + exactMatch falls back to whole-word", () => {
    expect(hit("free money", "win free money now", true)).toBe(true);
    expect(hit("free money", "freemoney", true)).toBe(false);
  });
});

describe("findMatchingRule — scope handling", () => {
  it("topic-scoped rules only fire inside their topic", () => {
    const r = [rule("coca", { scope: "topic", topicId: 5 })];
    expect(findMatchingRule(r, "toma coca", 5)).not.toBeNull();
    expect(findMatchingRule(r, "toma coca", 9)).toBeNull();
    expect(findMatchingRule(r, "toma coca", undefined)).toBeNull();
  });

  it("all-scoped rules fire regardless of thread", () => {
    const r = [rule("coca", { scope: "all" })];
    expect(findMatchingRule(r, "toma coca", 5)).not.toBeNull();
    expect(findMatchingRule(r, "toma coca", undefined)).not.toBeNull();
  });

  it("returns null when nothing matches", () => {
    expect(findMatchingRule([rule("coca")], "hola mundo", undefined)).toBeNull();
    expect(findMatchingRule([], "coca", undefined)).toBeNull();
  });
});
