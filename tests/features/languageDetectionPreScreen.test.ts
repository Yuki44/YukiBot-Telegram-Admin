import { describe, it, expect } from "vitest";
import { countWords, isCandidate } from "../../src/features/languageDetection/preScreen";

describe("countWords", () => {
  it("counts whitespace-separated words", () => {
    expect(countWords("How old are you")).toBe(4);
  });

  it("treats a single word as one", () => {
    expect(countWords("hola")).toBe(1);
  });

  it("ignores leading/trailing/duplicate whitespace", () => {
    expect(countWords("  hi   there  ")).toBe(2);
  });
});

describe("isCandidate — word-count gate", () => {
  it("never evaluates messages at or below LANGUAGE_MIN_WORDS (2)", () => {
    expect(isCandidate("not hard")).toBe(false);
    expect(isCandidate("hi")).toBe(false);
    expect(isCandidate("Hey")).toBe(false);
    expect(isCandidate("Dm")).toBe(false);
  });

  it("does not punish short DM requests — chat noise, not a language offense", () => {
    expect(isCandidate("dm")).toBe(false);
    expect(isCandidate("dm me")).toBe(false);
    expect(isCandidate("dm pls")).toBe(false);
  });

  it("lets a 3-word message through — the local detector and classifier judge it, not the word count", () => {
    // "Ey bro, abre" (Spanish + one loanword) and "comment ca marche" (real French)
    // are both 3 words; a word count alone can't tell them apart.
    expect(isCandidate("Ey bro, abre")).toBe(true);
    expect(isCandidate("comment ca marche")).toBe(true);
  });

  it("lets longer messages through regardless of language", () => {
    expect(isCandidate("Alguien vende una PS5 aca barata mamen")).toBe(true);
    expect(isCandidate("My flight got delayed again, this airline is a joke honestly.")).toBe(true);
  });
});
