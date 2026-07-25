import { WatchConfig } from "./matcher";

/**
 * Built-in token lists for the CSAM/impostor detector.
 *
 * Deliberately generous: solicitation only gates AUTO_BAN when a watched handle
 * is ALSO present, and negation/keyword tokens only ever downgrade to or trigger
 * a silence-for-review — so generosity here can never cause a false auto-ban.
 * Watched handles are NOT stored here (G2) — they come from CSAM_WATCH_HANDLES.
 */

/** Sale/solicitation tokens. Gate AUTO_BAN only alongside a watched handle. */
export const DEFAULT_SOLICITATION: string[] = [
  "ib",
  "cc",
  "ae",
  "chinh",
  "dm",
  "dm me",
  "text me",
  "text to my main",
  "main account",
  "hmu",
  "for buy",
  "to buy",
  "buy",
  "sell",
  "selling",
  "seller",
  "venta",
  "vendo",
  "compra",
  "comprar",
  "precio",
  "price",
  "link in bio",
  "menu",
];

/** Anti/negation tokens that BLOCK an auto-ban (the "no cp" ally case). */
export const DEFAULT_NEGATION: string[] = [
  "no cp",
  "nocp",
  "anti cp",
  "anti",
  "against",
  "report",
  "reportar",
  "denuncia",
  "denunciar",
  "scam",
  "scammer",
  "estafa",
  "estafador",
  "fake",
  "warning",
  "cuidado",
  "beware",
  "do not buy",
  "dont buy",
  "stop cp",
  "no pedo",
];

/**
 * Strong CSAM/abuse indicators for image OCR (silence-only, never auto-ban).
 *
 * Stored as space-free single tokens on purpose: single tokens route through the
 * fuzzy matcher, which tolerates leet AND the separators between characters — so
 * one token like "childporn" also catches "child porn", "ch!ld p0rn", "c.h.i.l.d.p.o.r.n".
 * A spaced phrase would fall back to a literal substring and miss all of that.
 */
export const DEFAULT_KEYWORDS: string[] = [
  "cpgei",
  "cpvideo",
  "cpvideos",
  "videoscp",
  "childporn",
  "kidporn",
  "kidsporn",
  "pedofilia",
  "pedophilia",
  "pedophile",
  "pornoinfantil",
  "zoofilia",
  "zoophilia",
  "bestiality",
];

/** Persisted additions from the DB singleton (all optional). */
export interface StoredWatchlist {
  handles?: string[];
  solicitation?: string[];
  negation?: string[];
  keywords?: string[];
}

const dedupeLower = (values: string[]): string[] =>
  Array.from(new Set(values.map((v) => v.trim().toLowerCase()).filter((v) => v)));

const dedupeHandles = (values: string[]): string[] => dedupeLower(values.map((v) => v.replace(/^@/, "")));

/**
 * Merge env-seeded + DB-stored watch data with the built-in defaults into the
 * WatchConfig the matcher consumes. Pure (no Mongo) so it is unit-testable.
 */
export function buildWatchConfig(
  stored: StoredWatchlist | null | undefined,
  envHandles: string[] = []
): WatchConfig {
  return {
    handles: dedupeHandles([...envHandles, ...(stored?.handles ?? [])]),
    solicitation: dedupeLower([...DEFAULT_SOLICITATION, ...(stored?.solicitation ?? [])]),
    negation: dedupeLower([...DEFAULT_NEGATION, ...(stored?.negation ?? [])]),
    keywords: dedupeLower([...DEFAULT_KEYWORDS, ...(stored?.keywords ?? [])]),
  };
}
