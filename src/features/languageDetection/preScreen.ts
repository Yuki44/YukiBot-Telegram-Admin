import { LANGUAGE_MIN_WORDS } from "../../config/constants";

// Excludes short tokens that collide with common English words (e.g. "a", "no", "so")
// to avoid false "skip" verdicts on genuine English candidates.
const STOPWORDS = new Set([
  // Spanish
  "que",
  "los",
  "las",
  "una",
  "uno",
  "unos",
  "unas",
  "por",
  "para",
  "pero",
  "como",
  "está",
  "esta",
  "esto",
  "eso",
  "estoy",
  "tengo",
  "tiene",
  "tienes",
  "hay",
  "muy",
  "más",
  "también",
  "porque",
  "cuando",
  "donde",
  "quiero",
  "puedo",
  "hacer",
  "voy",
  "vamos",
  "así",
  "ahora",
  "nunca",
  "siempre",
  "gracias",
  "hola",
  "vale",
  "pues",
  "entonces",
  "aquí",
  "allí",
  "bueno",
  "años",
  "todo",
  "toda",
  "todos",
  "todas",
  "algo",
  "alguien",
  "nada",
  "nadie",
  "nosotros",
  "ustedes",
  "ellos",
  "ellas",
  "quien",
  "cual",
  "cuales",
  "mamen",
  "mames",
  // Catalan
  "els",
  "les",
  "amb",
  "però",
  "això",
  "aquest",
  "aquesta",
  "sóc",
  "estic",
  "tinc",
  "molt",
  "perquè",
  "quan",
  "vull",
  "puc",
  "vaig",
  "anem",
  "gràcies",
  "doncs",
  "allà",
  "coses",
  "mateix",
  "poc",
  "tots",
  "totes",
  "algú",
  "ningú",
  "nosaltres",
  "vosaltres",
  "elles",
]);

/** Skip only when at least this many distinct stopwords are found — a margin against one coincidental hit. */
const MIN_STOPWORD_MATCHES = 2;

// Admin policy carve-out: "dm"/"dm me" requests carry real weight in this chat's context
// and must always reach the classifier, even though they'd otherwise be short enough for
// the word-count gate to silently exempt them. Exact-phrase match, not a substring search —
// a longer Spanish sentence that happens to mention "dm" already passes the word-count gate
// on its own and gets judged in full context by Stage 2.
const DM_REQUEST_PATTERNS = [/^dm$/, /^dm me$/, /^dm me pls$/, /^dm me please$/, /^dm pls$/, /^dm please$/];

function normalize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[.,!?¿¡"'“”:;()]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

export function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function looksLikeSpanishOrCatalan(text: string): boolean {
  const words = normalize(text);
  const matches = new Set(words.filter((w) => STOPWORDS.has(w)));
  return matches.size >= MIN_STOPWORD_MATCHES;
}

function isDmRequest(text: string): boolean {
  const normalized = normalize(text).join(" ");
  return DM_REQUEST_PATTERNS.some((p) => p.test(normalized));
}

/** Biased toward "candidate": a false positive here just costs one harmless Stage 2 call. */
export function isCandidate(text: string): boolean {
  if (isDmRequest(text)) return true;
  if (countWords(text) <= LANGUAGE_MIN_WORDS) return false;
  if (looksLikeSpanishOrCatalan(text)) return false;
  return true;
}
