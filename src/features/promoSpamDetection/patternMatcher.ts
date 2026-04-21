/**
 * Hardcoded promo/scam patterns.
 *
 * Rules for adding a pattern:
 *  - Must be multi-word and highly specific
 *  - Must NOT match common NSFW content (porn/adult chat is permitted)
 *  - For adult-service ADS: require both a solicitation phrase AND a contact-signal
 *    entity — but since we only have text here, require a contact keyword like
 *    "whatsapp", "telegram", "contacta", "escríbeme" adjacent to the service phrase
 */
interface HardcodedPattern {
  tag: string;
  regex: RegExp;
}

const HARDCODED_PATTERNS: HardcodedPattern[] = [
  // ── Crypto giveaways / doubling ───────────────────────────────────
  { tag: "crypto_double_en", regex: /send\s+[\d.,]+\s*(btc|eth|usdt|bnb|sol|xrp|ton)/i },
  { tag: "crypto_double_en2", regex: /i\s+will\s+double\s+your\s+(bitcoin|crypto|btc|eth)/i },
  { tag: "crypto_double_es", regex: /duplic[oa]\s+tu\s+(inversión|bitcoin|crypto|btc|eth)/i },
  { tag: "crypto_double_es2", regex: /te\s+dob(lo|la)\s+.{0,20}(btc|usdt|eth|crypto)/i },
  { tag: "crypto_free", regex: /\b(free|gratis)\s+(btc|eth|usdt|crypto|bitcoin)\b/i },
  { tag: "crypto_airdrop", regex: /\bairdrop\b.{0,40}\b(claim|reclaim|gratis|free)\b/i },
  { tag: "crypto_giveaway", regex: /\bgiveaway\b.{0,40}\b(btc|eth|usdt|crypto|bitcoin)\b/i },

  // ── Investment solicitations ───────────────────────────────────────
  { tag: "investment_guaranteed_es", regex: /inversión\s+(garantizada|segura|sin\s+riesgo)/i },
  {
    tag: "investment_earn_es",
    regex: /gana\s+(hasta\s+)?\d+\s*(%|usd|usdt|dólares).{0,30}(día|semana|mes)/i,
  },
  {
    tag: "investment_earn_en",
    regex: /earn\s+(up\s+to\s+)?\d+\s*(%|usd|usdt|dollars).{0,30}(day|week|month)/i,
  },
  { tag: "investment_profit_en", regex: /\b(guaranteed|100%)\s+(profit|returns?|earnings?)\b/i },
  {
    tag: "investment_signal_es",
    regex: /señales?\s+(de\s+)?(trading|forex|crypto).{0,30}(gratis|free|gana)/i,
  },
  {
    tag: "investment_signal_en",
    regex: /\b(trading|forex|crypto)\s+signals?\b.{0,40}\b(free|profit|earn)\b/i,
  },

  // ── "Join my channel/group" blasts ────────────────────────────────
  { tag: "join_channel_es", regex: /únete?\s+a\s+(mi|nuestro)\s+(canal|grupo|comunidad)/i },
  { tag: "join_channel_en", regex: /join\s+(my|our)\s+(channel|group|chat|community)/i },
  { tag: "join_channel_ru", regex: /подпишитесь\s+на\s+(мой|наш)\s+канал/i },
  { tag: "join_channel_ru2", regex: /вступайте\s+в\s+(мой|наш)\s+(канал|группу|чат)/i },
  { tag: "subscribe_channel_en", regex: /subscribe\s+to\s+(my|our)\s+(channel|group)/i },

  // ── Promotional adult SERVICE ADS (not NSFW content) ──────────────
  // These require BOTH a solicitation structure AND a contact keyword to avoid
  // flagging regular adult conversation
  {
    tag: "adult_ad_es",
    regex: /servicios?\s+(disponibles?|24\s*h|completos?).{0,60}(whatsapp|telegram|escríbeme|contáctame)/i,
  },
  {
    tag: "adult_ad_es2",
    regex: /(acompañante|escort|masajes?\s+eróticos?).{0,60}(whatsapp|telegram|escríbeme|contacta)/i,
  },
  {
    tag: "adult_ad_en",
    regex: /(escort|adult\s+service|massage\s+service).{0,60}(whatsapp|telegram|contact\s+me|dm\s+me)/i,
  },

  // ── Generic spam blasts ───────────────────────────────────────────
  { tag: "work_from_home_es", regex: /trabaja\s+(desde\s+casa|en\s+línea).{0,40}(gana|ingresos|dólares)/i },
  { tag: "work_from_home_en", regex: /work\s+from\s+home.{0,40}earn\s+\d+/i },
  { tag: "promo_blast_ru", regex: /зарабатывай.{0,30}(в\s+день|в\s+неделю|рублей|долларов)/i },
];

export interface PatternMatchResult {
  matched: boolean;
  tag: string;
}

/**
 * Checks text against hardcoded promo patterns and per-chat learned pattern hashes.
 *
 * @param text            Raw message text or caption
 * @param learnedPatternIds  Set of patternIds (7-char hashes) loaded from DB for this chat
 * @param normalizedHash  SHA-256 hex of normalizeText(text) — pass from outside to avoid re-hashing
 */
export function matchesSpamPattern(
  text: string,
  learnedPatternIds: Set<string>,
  normalizedHash: string
): PatternMatchResult {
  // Check learned patterns (exact hash match)
  const shortHash = normalizedHash.slice(0, 7);
  if (learnedPatternIds.has(shortHash)) {
    return { matched: true, tag: `aprendido:${shortHash}` };
  }

  // Check hardcoded patterns
  for (const { tag, regex } of HARDCODED_PATTERNS) {
    if (regex.test(text)) {
      return { matched: true, tag };
    }
  }

  return { matched: false, tag: "" };
}
