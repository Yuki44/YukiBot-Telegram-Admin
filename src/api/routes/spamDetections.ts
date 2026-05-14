import { Router, Request, Response } from "express";
import { authenticate } from "../middleware/authenticate";
import { requireChatAdmin } from "../middleware/requireChatAdmin";
import { spamPatternRepository } from "../../db/repositories/spamPatternRepository";
import { chatRepository } from "../../db/repositories/chatRepository";
import { userRepository } from "../../db/repositories/userRepository";
import { logger } from "../../utils/logger";
import { recordActivity } from "../../utils/activityLog";

const LIST_LIMIT_DEFAULT = 50;
const LIST_LIMIT_MAX = 200;
const PREVIEW_MAX_CHARS = 140;

type DetectionKind = "link" | "media" | "text";

interface SpamDetectionDto {
  patternId: string;
  chatId: number;
  kind: DetectionKind;
  /** Compact display text (domain for link, "[media:photo]" for media, truncated text otherwise). */
  preview: string;
  /** Full stored text — UI may show this in an expanded view. */
  fullText: string;
  /** Only set for link detections — the domain that "Permitir" promotes to linkWhitelist. */
  linkDomain?: string;
  triggeredByUserId: number;
  triggeredByName: string | null;
  triggeredByUsername: string | null;
  addedByUserId: number;
  createdAt: string;
}

/**
 * Derive what kind of detection this is from the stored text.
 *  - `[media:*]` markers → media (added by /spam on a media-only message)
 *  - any URL/hostname → link (extract the first non-Telegram hostname so "Permitir"
 *    promotes the actual spammy domain rather than t.me)
 *  - otherwise → text
 */
function classifyPattern(text: string): { kind: DetectionKind; linkDomain?: string } {
  if (/^\[media:[^\]]+\]/i.test(text.trim())) {
    return { kind: "media" };
  }

  const TELEGRAM_HOSTS = new Set(["t.me", "telegram.me", "telegram.dog"]);
  const hostRx = /(?:https?:\/\/)?(?:www\.)?((?:[a-z0-9-]+\.)+[a-z]{2,})(?:[\/:?#]|\b)/gi;

  let firstHost: string | null = null;
  let firstNonTelegramHost: string | null = null;
  let match: RegExpExecArray | null;
  while ((match = hostRx.exec(text)) !== null) {
    const host = match[1].toLowerCase();
    if (!firstHost) firstHost = host;
    if (!TELEGRAM_HOSTS.has(host)) {
      firstNonTelegramHost = host;
      break;
    }
  }

  const linkDomain = firstNonTelegramHost ?? firstHost;
  if (linkDomain) return { kind: "link", linkDomain };

  return { kind: "text" };
}

function buildPreview(kind: DetectionKind, text: string, linkDomain?: string): string {
  if (kind === "link" && linkDomain) return linkDomain;
  if (kind === "media") return text.trim();
  const oneLine = text.replace(/\s+/g, " ").trim();
  return oneLine.length > PREVIEW_MAX_CHARS
    ? oneLine.slice(0, PREVIEW_MAX_CHARS - 1) + "…"
    : oneLine;
}

export function createSpamDetectionsRouter(): Router {
  const router = Router({ mergeParams: true });

  router.use(authenticate);

  router.get("/", requireChatAdmin(), async (req: Request, res: Response) => {
    const chatId = Number(req.params.chatId);
    const rawLimit = Number(req.query.limit);
    const limit = Number.isFinite(rawLimit) && rawLimit > 0
      ? Math.min(rawLimit, LIST_LIMIT_MAX)
      : LIST_LIMIT_DEFAULT;

    try {
      const patterns = await spamPatternRepository.findRecentByChatId(chatId, limit);

      // Hydrate user identity in one pass — bulk-lookup keeps the request cheap
      // even when the inbox has dozens of patterns from many distinct users.
      const userIds = Array.from(new Set(patterns.map((p) => p.triggeredByUserId)));
      const users = await Promise.all(
        userIds.map((id) =>
          userRepository.findByUserAndChat(id, chatId).catch(() => null)
        )
      );
      const userById = new Map(
        users.filter((u): u is NonNullable<typeof u> => u !== null).map((u) => [u.userId, u])
      );

      const dtos: SpamDetectionDto[] = patterns.map((p) => {
        const { kind, linkDomain } = classifyPattern(p.text);
        const u = userById.get(p.triggeredByUserId);
        return {
          patternId: p.patternId,
          chatId: p.chatId,
          kind,
          preview: buildPreview(kind, p.text, linkDomain),
          fullText: p.text,
          ...(linkDomain ? { linkDomain } : {}),
          triggeredByUserId: p.triggeredByUserId,
          triggeredByName: u?.name ?? null,
          triggeredByUsername: u?.username ?? null,
          addedByUserId: p.addedByUserId,
          createdAt: p.createdAt.toISOString(),
        };
      });

      res.json(dtos);
    } catch (err) {
      logger.error({ action: "spam_detections.list", error: String(err), chatId });
      res.status(500).json({ error: "internal_error" });
    }
  });

  /**
   * Promote the pattern into the relevant whitelist and delete it from the inbox.
   *  - link patterns → linkWhitelist (the extracted domain)
   *  - media/text patterns → spamUserWhitelist (the user who triggered it)
   */
  router.post("/:patternId/permit", requireChatAdmin(), async (req: Request, res: Response) => {
    const chatId = Number(req.params.chatId);
    const patternId = String(req.params.patternId);

    try {
      const pattern = await spamPatternRepository.findByPatternId(chatId, patternId);
      if (!pattern) {
        res.status(404).json({ error: "pattern_not_found" });
        return;
      }

      const { kind, linkDomain } = classifyPattern(pattern.text);
      const actor = {
        id: req.user!.userId,
        name: req.user!.name,
        username: req.user!.username,
      };

      if (kind === "link" && linkDomain) {
        const updated = await chatRepository.addLinkWhitelist(chatId, linkDomain);
        if (!updated) {
          res.status(404).json({ error: "chat_not_found" });
          return;
        }
        recordActivity({
          chatId,
          type: "whitelist_add",
          source: "panel",
          actor,
          targetRef: linkDomain,
          reason: "permit_spam_detection",
        });
        await spamPatternRepository.removeByPatternId(chatId, patternId);
        logger.info({
          action: "spam_detections.permit",
          chatId,
          patternId,
          kind,
          linkDomain,
          userId: req.user!.userId,
        });
        res.json({ kind, linkDomain });
        return;
      }

      // Fallback for media + plain-text patterns: whitelist the triggering user.
      const updated = await chatRepository.addSpamUserWhitelist(chatId, pattern.triggeredByUserId);
      if (!updated) {
        res.status(404).json({ error: "chat_not_found" });
        return;
      }
      recordActivity({
        chatId,
        type: "whitelist_add",
        source: "panel",
        actor,
        target: { id: pattern.triggeredByUserId },
        reason: "permit_spam_detection",
      });
      await spamPatternRepository.removeByPatternId(chatId, patternId);
      logger.info({
        action: "spam_detections.permit",
        chatId,
        patternId,
        kind,
        triggeredByUserId: pattern.triggeredByUserId,
        userId: req.user!.userId,
      });
      res.json({ kind, userId: pattern.triggeredByUserId });
    } catch (err) {
      logger.error({ action: "spam_detections.permit", error: String(err), chatId, patternId });
      res.status(500).json({ error: "internal_error" });
    }
  });

  router.delete("/:patternId", requireChatAdmin(), async (req: Request, res: Response) => {
    const chatId = Number(req.params.chatId);
    const patternId = String(req.params.patternId);
    try {
      const removed = await spamPatternRepository.removeByPatternId(chatId, patternId);
      if (!removed) {
        res.status(404).json({ error: "pattern_not_found" });
        return;
      }
      logger.info({
        action: "spam_detections.discard",
        chatId,
        patternId,
        userId: req.user!.userId,
      });
      res.status(204).end();
    } catch (err) {
      logger.error({ action: "spam_detections.discard", error: String(err), chatId, patternId });
      res.status(500).json({ error: "internal_error" });
    }
  });

  return router;
}
