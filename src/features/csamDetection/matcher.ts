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
  verdict: BioVerdict;
  matched: boolean;
  handle?: string;
  keyword?: string;
  solicitation: string[];
  negation: string[];
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

// OCR-noise tolerance thresholds. Solicitation/negation stay conservative (a 1-edit
// window around a short common word collides too easily, e.g. "cd video" ≈ "cpvideo").
// The keyword list is the explicit CSAM lexicon — specific enough to tolerate shorter
// tokens, and it only ever triggers SILENCE-for-review, so a near-miss is cheap. This
// recovers real OCR garble like "cp gei" → "cplgei"/"tpgeil" (one edit from "cpgei").
const APPROX_MIN_LEN = 9;
const KEYWORD_APPROX_MIN_LEN = 5;
const HANDLE_APPROX_MIN_LEN = 6;
const approxBudget = (len: number): number => (len >= 13 ? 2 : 1);

/**
 * A distinctive digit-bearing handle recovered from OCR noise by bounded edit
 * distance. The handle garbles a different way every send — "@Nomax16" comes back
 * "@Nomax:l6" (1→l), "@Nomax] 6" → compact "nomax6" (1 dropped), or "Onomax16" (@
 * fused on) — and all land within one edit of the compacted handle. Lower-confidence
 * than the strict path, so callers use it only to SILENCE-for-review, never to
 * auto-ban; digit-bearing + min length keep it from firing on ordinary words.
 */
function looseImageHandle(compact: string, handles: string[]): string | undefined {
  return handles.find((h) => {
    const needle = compactAlnum(normalize(h));
    if (needle.length < HANDLE_APPROX_MIN_LEN || !/[0-9]/.test(needle)) return false;
    return approxContains(compact, needle, approxBudget(needle.length));
  });
}

/**
 * Term hit for OCR'd image text: the strict fuzzy path (leet/separators) OR, for
 * tokens at least `minLen` long, a bounded edit-distance match that survives single
 * mis-read characters. Only the image tier uses this looser path; handles and bios
 * never do.
 */
function imageKeywordMatch(
  folded: string,
  foldedSpaced: string,
  compact: string,
  term: string,
  minLen: number = APPROX_MIN_LEN
): boolean {
  if (termMatches(folded, foldedSpaced, term)) return true;
  const needle = compactAlnum(normalize(term));
  if (needle.length < minLen) return false;
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

/**
 * Mirrors evaluateBio: AUTO_BAN on handle + (solicitation OR explicit CSAM keyword),
 * no negation; else SILENCE on a lone handle/keyword. The keyword counts because a
 * watched handle next to "cp gei"/"childporn" IS the ad, even when the sale phrase
 * didn't survive OCR. Only a STRICT handle (leet/separator/homoglyph tolerant,
 * boundaried) may auto-ban; an OCR-fuzzy handle recovered by edit distance is lower
 * confidence and only ever silences for human review — a false positive there is cheap,
 * a false auto-ban is not (G3: bans never revert).
 */
export function evaluateImageText(text: string, config: WatchConfig): ImageResult {
  const folded = normalizeAndFold(text ?? "");
  const foldedSpaced = collapseSpaces(folded);
  const compact = compactAlnum(folded);

  const strictHandle = firstMatch(folded, foldedSpaced, config.handles);
  const handle = strictHandle ?? looseImageHandle(compact, config.handles);
  const keyword = (config.keywords ?? []).find((t) =>
    imageKeywordMatch(folded, foldedSpaced, compact, t, KEYWORD_APPROX_MIN_LEN)
  );
  const solicitation = config.solicitation.filter((t) => imageKeywordMatch(folded, foldedSpaced, compact, t));
  const negation = config.negation.filter((t) => imageKeywordMatch(folded, foldedSpaced, compact, t));

  let verdict: BioVerdict = "NONE";
  if (strictHandle && (solicitation.length > 0 || keyword) && negation.length === 0) {
    verdict = "AUTO_BAN";
  } else if (handle || keyword) {
    verdict = "SILENCE";
  }

  return { verdict, matched: verdict !== "NONE", handle, keyword, solicitation, negation };
}
