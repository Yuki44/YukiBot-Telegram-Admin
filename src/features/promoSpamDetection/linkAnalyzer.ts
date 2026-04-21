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

function extractHostname(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

function isTelegramHostname(hostname: string): boolean {
  return hostname === "t.me" || hostname === "telegram.me" || hostname === "telegram.dog";
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
}

/**
 * Analyses message entities for spam links.
 * Only reads Telegram entities — never runs regex on raw message text.
 *
 * Flags:
 *  - Forwarded channel/group messages
 *  - All t.me/ links (channels, groups, invite links, videochats, profiles — all)
 *  - Known URL shortener hostnames
 *  - Any external URL not in linkWhitelist (no exceptions by default)
 *
 * @param entities            Message entities from ctx.message.entities / caption_entities
 * @param messageText         Raw message text (needed to extract 'url' entity values)
 * @param isForwardedFromChannel  True when forward_origin.type is "channel" or "chat"
 * @param linkWhitelist       Domains stored in Chat.linkWhitelist (e.g. "example.com")
 */
export function analyzeLinks(
  entities: Entity[],
  messageText: string,
  isForwardedFromChannel: boolean,
  linkWhitelist: string[]
): LinkAnalysisResult {
  // Forwarded channel/group messages are always spam
  if (isForwardedFromChannel) {
    return { flagged: true, reason: "mensaje_reenviado_de_canal" };
  }

  for (const entity of entities) {
    if (entity.type !== "url" && entity.type !== "text_link") continue;

    const url = extractUrl(entity, messageText);
    if (!url) continue;

    // Ensure the URL has a protocol so new URL() can parse it
    const normalizedUrl = url.startsWith("http") ? url : `https://${url}`;

    const hostname = extractHostname(normalizedUrl);
    if (!hostname) continue;

    if (isTelegramHostname(hostname)) {
      return { flagged: true, reason: "enlace_de_telegram" };
    }

    if (isUrlShortener(hostname)) {
      return { flagged: true, reason: `acortador_url:${hostname}` };
    }

    if (!isWhitelisted(hostname, linkWhitelist)) {
      return { flagged: true, reason: `enlace_externo:${hostname}` };
    }
  }

  return { flagged: false, reason: "" };
}
