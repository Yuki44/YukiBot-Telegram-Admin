import { IBannedWord } from "../../types";

// Combining diacritical marks block (U+0300–U+036F). Defined via String.fromCharCode
// so the source file stays pure ASCII — file-encoding issues can otherwise corrupt
// the raw range characters.
const COMBINING_MARKS_RE = new RegExp(
  `[${String.fromCharCode(0x0300)}-${String.fromCharCode(0x036f)}]`,
  "g"
);

/** Lowercase + strip diacritics so "Camión" and "camion" compare equal. */
export function normalize(text: string): string {
  return text.toLowerCase().normalize("NFD").replace(COMBINING_MARKS_RE, "");
}

function escapeForRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Find the first rule that matches the given message text, restricted to rules whose
 * scope applies to the current location:
 *  - scope === "all"   → always considered
 *  - scope === "topic" → only when rule.topicId === threadId
 *
 * exactMatch uses Unicode-aware word boundaries; otherwise a substring check.
 * Both inputs are lowercased and diacritic-stripped first.
 */
export function findMatchingRule(
  rules: IBannedWord[],
  text: string,
  threadId: number | undefined
): IBannedWord | null {
  if (!text) return null;
  const haystack = normalize(text);

  for (const rule of rules) {
    if (rule.scope === "topic") {
      if (typeof rule.topicId !== "number") continue;
      if (rule.topicId !== threadId) continue;
    }

    const needle = normalize(rule.word);
    if (!needle) continue;

    if (rule.exactMatch) {
      const re = new RegExp(
        `(?:^|[^\\p{L}\\p{N}])${escapeForRegex(needle)}(?:[^\\p{L}\\p{N}]|$)`,
        "u"
      );
      if (re.test(haystack)) return rule;
    } else if (haystack.includes(needle)) {
      return rule;
    }
  }

  return null;
}
