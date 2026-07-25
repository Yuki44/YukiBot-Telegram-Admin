import {
  normalize,
  normalizeAndFold,
  buildFuzzyRegex,
  compactAlnum,
  approxContains,
} from "../../utils/fuzzyText";

/**
 * CSAM / impostor text matcher.
 *
 * Two sensitivities, both reusing the shared hardened fuzzy primitives (G14):
 *  - evaluateBio    → STRICT predicate; the ONLY path allowed to auto-ban.
 *  - evaluateImageText → AGGRESSIVE (silence-only), so a false positive is cheap.
 *
 * Because auto-ban requires handle + solicitation + no-negation, a solicitation
 * word we don't recognise (e.g. an unlisted language) can only ever DOWNGRADE a
 * hit to SILENCE — never miss it and never wrongly auto-ban.
 */

export type BioVerdict = "AUTO_BAN" | "SILENCE" | "NONE";

export interface WatchConfig {
  /** Identity signals (e.g. "nomax16"). Presence alone ⇒ at least SILENCE. */
  handles: string[];
  /** Sale/solicitation tokens (multilingual, configurable). Gate auto-ban. */
  solicitation: string[];
  /** Anti/negation tokens that block auto-ban (e.g. "no cp", "report"). */
  negation: string[];
  /** Extra silence-only triggers for images/bios (e.g. "cp gei"). */
  keywords?: string[];
}

export interface BioResult {
  verdict: BioVerdict;
  handle?: string;
  solicitation: string[];
  negation: string[];
}

export interface ImageResult {
  matched: boolean;
  handle?: string;
  keyword?: string;
}

function collapseSpaces(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/**
 * A term matches when it appears as a boundaried token. Single words use the
 * fuzzy regex (leet/homoglyph/separator tolerant); multi-word phrases use a
 * whitespace-flexible substring on the folded text.
 */
function termMatches(folded: string, foldedSpaced: string, term: string): boolean {
  const needle = collapseSpaces(normalize(term));
  if (!needle) return false;
  if (/\s/.test(needle)) return foldedSpaced.includes(needle);
  return buildFuzzyRegex(needle).test(folded);
}

function firstMatch(folded: string, foldedSpaced: string, terms: string[]): string | undefined {
  return terms.find((t) => termMatches(folded, foldedSpaced, t));
}

// OCR-noise tolerance for image keywords only. Short tokens are excluded because a
// 1-edit window around them collides with common words (e.g. "cd video" ≈ "cpvideo").
const APPROX_MIN_LEN = 9;
const approxBudget = (len: number): number => (len >= 13 ? 2 : 1);

/**
 * Keyword hit for OCR'd image text: the strict fuzzy path (leet/separators) OR,
 * for long-enough tokens, a bounded edit-distance match that survives single
 * mis-read characters. Image keywords only ever trigger SILENCE-for-review, so a
 * near-miss is cheap; handles and bios never use this looser path.
 */
function imageKeywordMatch(folded: string, foldedSpaced: string, compact: string, term: string): boolean {
  if (termMatches(folded, foldedSpaced, term)) return true;
  const needle = compactAlnum(normalize(term));
  if (needle.length < APPROX_MIN_LEN) return false;
  return approxContains(compact, needle, approxBudget(needle.length));
}

function allMatches(folded: string, foldedSpaced: string, terms: string[]): string[] {
  return terms.filter((t) => termMatches(folded, foldedSpaced, t));
}

/** STRICT bio predicate — the only place auto-ban may originate. */
export function evaluateBio(bio: string, config: WatchConfig): BioResult {
  const folded = normalizeAndFold(bio ?? "");
  const foldedSpaced = collapseSpaces(folded);

  const handle = firstMatch(folded, foldedSpaced, config.handles);
  if (!handle) return { verdict: "NONE", solicitation: [], negation: [] };

  const solicitation = allMatches(folded, foldedSpaced, config.solicitation);
  const negation = allMatches(folded, foldedSpaced, config.negation);

  const verdict: BioVerdict = solicitation.length > 0 && negation.length === 0 ? "AUTO_BAN" : "SILENCE";
  return { verdict, handle, solicitation, negation };
}

/** AGGRESSIVE image/OCR text check — any handle OR CSAM keyword ⇒ matched (⇒ silence). */
export function evaluateImageText(text: string, config: WatchConfig): ImageResult {
  const folded = normalizeAndFold(text ?? "");
  const foldedSpaced = collapseSpaces(folded);
  const compact = compactAlnum(folded);

  const handle = firstMatch(folded, foldedSpaced, config.handles);
  const keyword = (config.keywords ?? []).find((t) => imageKeywordMatch(folded, foldedSpaced, compact, t));
  return { matched: Boolean(handle || keyword), handle, keyword };
}
