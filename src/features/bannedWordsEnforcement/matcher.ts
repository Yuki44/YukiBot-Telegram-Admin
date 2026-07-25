import { IBannedWord } from "../../types";
import { normalize, normalizeAndFold, buildFuzzyRegex, buildWholeWordRegex } from "../../utils/fuzzyText";

// Text-fuzzing primitives (diacritics, homoglyphs, invisibles, leet, separators)
// live in the shared utils/fuzzyText helper so banned-words and CSAM detection
// share ONE hardened implementation (G14). Re-export normalize for callers/tests.
export { normalize };

/**
 * Find the first rule that matches the given message text, restricted to rules whose
 * scope applies to the current location:
 *  - scope === "all"   → always considered
 *  - scope === "topic" → only when rule.topicId === threadId
 *
 * Matching is ALWAYS whole-word (Unicode boundaries) — a rule for "coca" never
 * matches "cocacola". When `exactMatch` is true the word is additionally matched
 * fuzzily: leet/symbol swaps, padding, intra-word separators, and a curated set
 * of Unicode homoglyphs / emoji (e.g. "c0c4", "c.p", Cyrillic "coca", letter
 * emojis). Fuzzy mode only applies to single-token words; legacy multi-word
 * phrases fall back to the whole-word check. Both inputs are lowercased and
 * diacritic-stripped first.
 */
export function findMatchingRule(
  rules: IBannedWord[],
  text: string,
  threadId: number | undefined
): IBannedWord | null {
  if (!text) return null;
  const haystack = normalize(text);
  const foldedHaystack = normalizeAndFold(text);

  for (const rule of rules) {
    if (rule.scope === "topic") {
      if (typeof rule.topicId !== "number") continue;
      if (rule.topicId !== threadId) continue;
    }

    const needle = normalize(rule.word);
    if (!needle) continue;

    const fuzzy = rule.exactMatch && !/\s/.test(needle);
    if (fuzzy) {
      if (buildFuzzyRegex(needle).test(foldedHaystack)) return rule;
    } else if (buildWholeWordRegex(needle).test(haystack)) {
      return rule;
    }
  }

  return null;
}
