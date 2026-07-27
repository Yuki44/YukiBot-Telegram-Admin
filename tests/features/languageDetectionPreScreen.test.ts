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

describe("isCandidate — Stage 1 gate", () => {
  it("never evaluates messages at or below LANGUAGE_MIN_WORDS (2)", () => {
    expect(isCandidate("not hard")).toBe(false);
    expect(isCandidate("hi")).toBe(false);
    expect(isCandidate("Hey")).toBe(false);
    expect(isCandidate("Dm")).toBe(false);
  });

  it("flags a 3-word message as a candidate even though it's short — Stage 2 tells loanword from genuine foreign phrase", () => {
    // "Ey bro, abre" (Spanish + one loanword) and "comment ca marche" (real French)
    // are both 3 words; the word-count gate alone can't distinguish them, so both
    // now reach the classifier rather than being silently skipped.
    expect(isCandidate("Ey bro, abre")).toBe(true);
    expect(isCandidate("comment ca marche")).toBe(true);
  });

  it("does not punish short DM requests — chat noise, not a language offense", () => {
    expect(isCandidate("dm")).toBe(false);
    expect(isCandidate("dm me")).toBe(false);
    expect(isCandidate("dm pls")).toBe(false);
  });

  it("skips confidently-Spanish messages, even bad-grammar slang", () => {
    expect(isCandidate("Alguien vende una PS5 aca barata mamen")).toBe(false);
  });

  it("skips confidently-Catalan messages", () => {
    expect(isCandidate("Bon dia a tothom, com estàs avui? Espero que molt bé")).toBe(false);
  });

  it("flags a blatant, coherent English message as a candidate", () => {
    expect(isCandidate("My flight got delayed again, this airline is a joke honestly.")).toBe(true);
  });

  it("flags a coherent English question as a candidate", () => {
    expect(isCandidate("How old are you")).toBe(true);
  });

  it("does not false-positive-skip English on a single coincidental word overlap", () => {
    // "es" isn't in the stopword list and no other Spanish/Catalan word appears here —
    // guards the MIN_STOPWORD_MATCHES margin against one-off collisions.
    expect(isCandidate("Send me a message right now please")).toBe(true);
  });
});
