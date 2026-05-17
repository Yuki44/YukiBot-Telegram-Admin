import { IBannedWord } from "../../types";

// Every functionally-significant invisible/range codepoint (combining marks,
// zero-width chars, variation selectors, homoglyph & emoji ranges) is built via
// String.fromCodePoint / \u escapes so a source-encoding mishap can't silently
// corrupt the confusable tables — same defensive pattern as COMBINING_MARKS_RE.
// A handful of visible punctuation look-alikes are kept as literals for
// readability (they can't be invisibly mangled).

// Combining diacritical marks block (U+0300–U+036F).
const COMBINING_MARKS_RE = new RegExp(`[${String.fromCharCode(0x0300)}-${String.fromCharCode(0x036f)}]`, "g");

/** Lowercase + strip diacritics so "Camion" and "camion" compare equal. */
export function normalize(text: string): string {
  return text.toLowerCase().normalize("NFD").replace(COMBINING_MARKS_RE, "");
}

function escapeForRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Escape the characters that are special *inside* a regex character class. */
function escapeForCharClass(s: string): string {
  return s.replace(/[\\\]^-]/g, "\\$&");
}

// ── Confusable folding (fuzzy mode only) ─────────────────────────────
//
// A curated, finite table mapping common Unicode look-alikes back to their base
// latin letter so a disguised word like "coca" written in Cyrillic or with
// letter-emojis folds to "coca" before matching.

const HOMOGLYPHS: Record<string, string> = {};

/** Map a contiguous codepoint range onto base..base+len (e.g. emoji A..Z). */
function mapRange(startCode: number, endCode: number, baseLetter: string): void {
  const base = baseLetter.charCodeAt(0);
  for (let i = 0; startCode + i <= endCode; i++) {
    HOMOGLYPHS[String.fromCodePoint(startCode + i)] = String.fromCharCode(base + i);
  }
}

// Hand-picked single-letter look-alikes, keyed by codepoint (input is already
// lowercased by normalize()). [codepoint, baseLatinLetter].
const SINGLE_HOMOGLYPHS: ReadonlyArray<readonly [number, string]> = [
  // Cyrillic lowercase
  [0x0430, "a"],
  [0x0432, "b"],
  [0x0435, "e"],
  [0x043a, "k"],
  [0x043c, "m"],
  [0x043d, "h"],
  [0x043e, "o"],
  [0x0440, "p"],
  [0x0441, "c"],
  [0x0442, "t"],
  [0x0443, "y"],
  [0x0445, "x"],
  [0x0455, "s"],
  [0x0456, "i"],
  [0x0458, "j"],
  [0x0501, "d"],
  // Greek lowercase
  [0x03b1, "a"],
  [0x03b2, "b"],
  [0x03b5, "e"],
  [0x03b9, "i"],
  [0x03ba, "k"],
  [0x03bd, "v"],
  [0x03bf, "o"],
  [0x03c1, "p"],
  [0x03c4, "t"],
  [0x03c5, "u"],
  [0x03c7, "x"],
  // Latin-1 letter-like symbols: (c)=copyright, (r)=registered
  [0x00a9, "c"],
  [0x00ae, "r"],
];
for (const [cp, letter] of SINGLE_HOMOGLYPHS) {
  HOMOGLYPHS[String.fromCodePoint(cp)] = letter;
}

// Fullwidth latin a–z (U+FF41–U+FF5A) and digits 0–9 (U+FF10–U+FF19).
mapRange(0xff41, 0xff5a, "a");
for (let d = 0; d <= 9; d++) HOMOGLYPHS[String.fromCodePoint(0xff10 + d)] = String(d);

// Squared latin capital A–Z (U+1F130–U+1F149).
mapRange(0x1f130, 0x1f149, "a");
// Negative-squared latin capital A–Z (U+1F170–U+1F189) — the "A-in-a-box" style.
mapRange(0x1f170, 0x1f189, "a");
// Regional indicator symbols A–Z (U+1F1E6–U+1F1FF) — flag-letter emojis.
mapRange(0x1f1e6, 0x1f1ff, "a");
// Circled latin small a–z (U+24D0–U+24E9) and capital A–Z (U+24B6–U+24CF).
mapRange(0x24d0, 0x24e9, "a");
mapRange(0x24b6, 0x24cf, "a");
// Parenthesized latin small a–z (U+249C–U+24B5).
mapRange(0x249c, 0x24b5, "a");

// Invisible characters frequently injected to break naive matchers: variation
// selectors (U+FE00–U+FE0F), zero-width space/joiner family, word-joiner, BOM.
const INVISIBLE_CODEPOINTS = [
  ...Array.from({ length: 0xfe0f - 0xfe00 + 1 }, (_, i) => 0xfe00 + i),
  0x200b,
  0x200c,
  0x200d,
  0x2060,
  0xfeff,
];
const INVISIBLES_RE = new RegExp(
  `[${INVISIBLE_CODEPOINTS.map((c) => `\\u${c.toString(16).padStart(4, "0")}`).join("")}]`,
  "g"
);

/** Strip invisibles and fold curated homoglyphs/emoji to base latin letters. */
function foldConfusables(text: string): string {
  let out = "";
  for (const ch of text.replace(INVISIBLES_RE, "")) {
    out += HOMOGLYPHS[ch] ?? ch;
  }
  return out;
}

// ── Fuzzy regex construction ─────────────────────────────────────────

// Per-letter leet/symbol substitutions the fold step does NOT cover (ASCII
// digits & punctuation, plus a couple of visible currency look-alikes). The
// base letter is always included.
const LEET_CLASSES: Record<string, string> = {
  a: "a@4",
  b: "b8",
  c: "c(<{¢",
  e: "e3€",
  g: "g9",
  i: "i1!|l",
  l: "l1|i",
  o: "o0",
  q: "q9",
  s: "s5$",
  t: "t7+",
  z: "z2",
};

// Separators / padding allowed *between* needle characters: "c.p", "c-p",
// "c. p", "c_p", middle-dot, bullet, … (zero or more).
const MIDDLE_DOT = "·";
const BULLET = "•";
const SEP = `[\\s.\\-_*${MIDDLE_DOT}${BULLET}|/\\\\~:;,'"]*`;
// A character that would extend a word — used for Unicode-aware boundaries.
const WORD = "[\\p{L}\\p{N}]";

function fuzzyCharFragment(ch: string): string {
  const members = LEET_CLASSES[ch] ?? ch;
  return `[${escapeForCharClass(members)}]+`;
}

/** Build a fuzzy, boundary-anchored regex from an already-normalized needle. */
function buildFuzzyRegex(needle: string): RegExp {
  const body = Array.from(needle).map(fuzzyCharFragment).join(SEP);
  return new RegExp(`(?<!${WORD})${body}(?!${WORD})`, "u");
}

/** Build the whole-word (literal) regex from an already-normalized needle. */
function buildWholeWordRegex(needle: string): RegExp {
  return new RegExp(`(?<!${WORD})${escapeForRegex(needle)}(?!${WORD})`, "u");
}

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
  const foldedHaystack = foldConfusables(haystack);

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
