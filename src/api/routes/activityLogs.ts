import { Router, Request, Response } from "express";
import { authenticate } from "../middleware/authenticate";
import { requireChatAdmin } from "../middleware/requireChatAdmin";
import { activityLogRepository } from "../../db/repositories/activityLogRepository";
import { logger } from "../../utils/logger";
import { ActivityLogType, IActivityLog } from "../../types";

const VALID_TYPES: ActivityLogType[] = [
  "warn",
  "unwarn",
  "silence",
  "unsilence",
  "ban",
  "unban",
  "kick",
  "autoban",
  "pardon",
  "feature_toggle",
  "topic_rule_change",
  "whitelist_add",
  "whitelist_remove",
  "combo_add",
  "combo_remove",
  "banned_word_add",
  "banned_word_remove",
  "owner_delegate",
  "owner_revoke",
];

function toDto(log: IActivityLog) {
  return {
    id: String(log._id),
    chatId: log.chatId,
    type: log.type,
    source: log.source,
    actorId: log.actorId,
    actorName: log.actorName ?? null,
    actorUsername: log.actorUsername ?? null,
    targetId: log.targetId ?? null,
    targetName: log.targetName ?? null,
    targetUsername: log.targetUsername ?? null,
    targetRef: log.targetRef ?? null,
    reason: log.reason ?? null,
    topicId: log.topicId ?? null,
    warningsAfter: log.warningsAfter ?? null,
    messageText: log.messageText ?? null,
    timestamp: log.timestamp.toISOString(),
  };
}

export function createActivityLogsRouter(): Router {
  const router = Router({ mergeParams: true });

  router.use(authenticate);

  router.get("/", requireChatAdmin(), async (req: Request, res: Response) => {
    const chatId = Number(req.params.chatId);

    // type filter — comma-separated list, all unknown values silently dropped
    const typeRaw = (req.query.type as string) ?? "";
    const requestedTypes = typeRaw
      .split(",")
      .map((t) => t.trim())
      .filter((t): t is ActivityLogType => VALID_TYPES.includes(t as ActivityLogType));
    const typeFilter = requestedTypes.length > 0 ? requestedTypes : undefined;

    const q = typeof req.query.q === "string" ? req.query.q.trim() : "";

    let before: Date | undefined;
    if (typeof req.query.before === "string") {
      const parsed = new Date(req.query.before);
      if (!isNaN(parsed.getTime())) before = parsed;
    }

    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);

    try {
      const entries = await activityLogRepository.listByChat(chatId, {
        type: typeFilter,
        q: q || undefined,
        before,
        limit,
      });
      res.json({
        entries: entries.map(toDto),
        // Pagination cursor — pass back as `before=` for the next page
        nextBefore: entries.length === limit ? entries[entries.length - 1].timestamp.toISOString() : null,
      });
    } catch (err) {
      logger.error({ action: "activityLogs.list", error: String(err), chatId });
      res.status(500).json({ error: "internal_error" });
    }
  });

  return router;
}
