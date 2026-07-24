/** Entity shape we need — subset of Telegram MessageEntity */
interface Entity {
  type: string;
  offset?: number;
  length?: number;
  url?: string;
}

/** Hostnames considered URL shorteners */
const SHORTENER_HOSTNAMES = new Set([
  "bit.ly",
  "tinyurl.com",
  "t.co",
  "rb.gy",
  "cutt.ly",
  "shorturl.at",
  "ow.ly",
  "is.gd",
  "buff.ly",
  "tiny.cc",
]);

/**
 * TLDs that never double as ordinary Spanish/English words (unlike .es/.no/.si/.me/.la/.ke).
 * A bare, scheme-less "word.word" match is only high-confidence when its TLD is on this list.
 */
const CONFIDENT_BARE_TLDS = new Set([
  "com",
  "net",
  "org",
  "info",
  "biz",
  "name",
  "mobi",
  "pro",
  "xyz",
  "top",
  "click",
  "link",
  "shop",
  "site",
  "online",
  "store",
  "club",
  "vip",
  "win",
  "pw",
  "icu",
  "cyou",
  "buzz",
  "cam",
  "rest",
  "sbs",
  "cfd",
  "monster",
  "work",
  "fun",
  "live",
  "app",
  "dev",
]);

function extractHostname(url: string): { hostname: string; hadWww: boolean } | null {
  try {
    const raw = new URL(url).hostname;
    const hadWww = /^www\./i.test(raw);
    return { hostname: raw.replace(/^www\./i, ""), hadWww };
  } catch {
    return null;
  }
}

/** 3+ labels or a confident TLD — rarely produced by a missing-space typo. */
function isConfidentBareMatch(hostname: string): boolean {
  const labels = hostname.split(".").filter(Boolean);
  if (labels.length >= 3) return true;
  const tld = (labels[labels.length - 1] ?? "").toLowerCase();
  return CONFIDENT_BARE_TLDS.has(tld);
}

function isTelegramHostname(hostname: string): boolean {
  return hostname === "t.me" || hostname === "telegram.me" || hostname === "telegram.dog";
}

/**
 * Returns true when a t.me URL is a message link pointing back to the same chat.
 * Covers both private supergroups (t.me/c/{rawId}/…) and public groups (t.me/{username}/…).
 * "rawId" is the numeric chatId with the -100 prefix stripped.
 */
function isSelfChatLink(url: string, selfChatId?: number, selfChatUsername?: string): boolean {
  let pathname: string;
  try {
    pathname = new URL(url).pathname;
  } catch {
    return false;
  }

  if (selfChatId !== undefined) {
    const rawId = String(selfChatId).replace(/^-100/, "");
    if (pathname.startsWith(`/c/${rawId}/`)) return true;
  }

  if (selfChatUsername) {
    const lower = selfChatUsername.toLowerCase();
    if (pathname.toLowerCase().startsWith(`/${lower}/`)) return true;
  }

  return false;
}

function isUrlShortener(hostname: string): boolean {
  return SHORTENER_HOSTNAMES.has(hostname);
}

function isWhitelisted(hostname: string, linkWhitelist: string[]): boolean {
  return linkWhitelist.some((entry) => hostname === entry || hostname.endsWith("." + entry));
}

/**
 * Extract the raw URL string from an entity.
 * - text_link entities carry entity.url directly.
 * - url entities must be sliced from the message text using offset+length.
 */
function extractUrl(entity: Entity, messageText: string): string {
  if (entity.type === "text_link") {
    return entity.url ?? "";
  }
  if (entity.type === "url" && entity.offset !== undefined && entity.length !== undefined) {
    return messageText.slice(entity.offset, entity.offset + entity.length);
  }
  return "";
}

export interface LinkAnalysisResult {
  flagged: boolean;
  reason: string;
  /** "low" = bare unconfirmed-TLD match (likely a missing-space typo) — caller should not auto-punish. */
  confidence: "high" | "low";
}

/**
 * Analyses message entities for spam links.
 * Only reads Telegram entities — never runs regex on raw message text.
 *
 * Flags:
 *  - Forwarded channel/group messages
 *  - All t.me/ links (channels, groups, invite links, videochats, profiles — all)
 *  - Known URL shortener hostnames
 *  - Any external URL not in linkWhitelist — "low" confidence when it's a bare
 *    two-label match with an unconfirmed TLD (see CONFIDENT_BARE_TLDS)
 *
 * @param entities            Message entities from ctx.message.entities / caption_entities
 * @param messageText         Raw message text (needed to extract 'url' entity values)
 * @param isForwardedFromChannel  True when forward_origin.type is "channel" or "chat"
 * @param linkWhitelist       Domains stored in Chat.linkWhitelist (e.g. "example.com")
 * @param selfChatId          The current chat's numeric ID — self-referential message links are allowed
 * @param selfChatUsername    The current chat's public username (if any) — used for public-group message links
 */
export function analyzeLinks(
  entities: Entity[],
  messageText: string,
  isForwardedFromChannel: boolean,
  linkWhitelist: string[],
  selfChatId?: number,
  selfChatUsername?: string
): LinkAnalysisResult {
  // Forwarded channel/group messages are always spam
  if (isForwardedFromChannel) {
    return { flagged: true, reason: "mensaje_reenviado_de_canal", confidence: "high" };
  }

  for (const entity of entities) {
    if (entity.type !== "url" && entity.type !== "text_link") continue;

    const url = extractUrl(entity, messageText);
    if (!url) continue;

    // Ensure the URL has a protocol so new URL() can parse it
    const normalizedUrl = url.startsWith("http") ? url : `https://${url}`;

    const extracted = extractHostname(normalizedUrl);
    if (!extracted) continue;
    const { hostname, hadWww } = extracted;

    if (isTelegramHostname(hostname)) {
      if (isSelfChatLink(normalizedUrl, selfChatId, selfChatUsername)) continue;
      return { flagged: true, reason: "enlace_de_telegram", confidence: "high" };
    }

    if (isUrlShortener(hostname)) {
      return { flagged: true, reason: `acortador_url:${hostname}`, confidence: "high" };
    }

    if (!isWhitelisted(hostname, linkWhitelist)) {
      const hasScheme = /^https?:\/\//i.test(url);
      const confidence: "high" | "low" =
        hasScheme || hadWww || isConfidentBareMatch(hostname) ? "high" : "low";
      return { flagged: true, reason: `enlace_externo:${hostname}`, confidence };
    }
  }

  return { flagged: false, reason: "", confidence: "high" };
}
