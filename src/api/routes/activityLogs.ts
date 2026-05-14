import { Router, Request, Response } from "express";
import { Bot } from "grammy";
import { authenticate } from "../middleware/authenticate";
import { requireChatAdmin } from "../middleware/requireChatAdmin";
import { activityLogRepository } from "../../db/repositories/activityLogRepository";
import { chatRepository } from "../../db/repositories/chatRepository";
import { adminRepository } from "../../db/repositories/adminRepository";
import { userDomainAllowanceRepository } from "../../db/repositories/userDomainAllowanceRepository";
import { bannedWordRepository } from "../../db/repositories/bannedWordRepository";
import { logger } from "../../utils/logger";
import { recordActivity } from "../../utils/activityLog";
import { ActivityLogType, BotContext, IActivityLog } from "../../types";
import {
  ActorInfo,
  unbanUserViaApi,
  unsilenceUserViaApi,
} from "../services/userActions";
import { userRepository } from "../../db/repositories/userRepository";

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
  "spam_confirmed",
];

/**
 * Types the dashboard's Undo button can reverse. The complement is shown in the UI but
 * without an Undo affordance — either because they're already inverses themselves
 * (unwarn, unban, …), or because the original action has no safe reverse (kick — Telegram
 * doesn't expose re-invite for non-public chats; pardon — record was wiped; topic rule
 * changes — pre-change state isn't snapshotted).
 */
const UNDOABLE: ReadonlySet<ActivityLogType> = new Set([
  "warn",
  "silence",
  "ban",
  "autoban",
  "feature_toggle",
  "whitelist_add",
  "combo_add",
  "banned_word_add",
  "owner_delegate",
]);

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
    undoneAt: log.undoneAt ? log.undoneAt.toISOString() : null,
    timestamp: log.timestamp.toISOString(),
  };
}

export function createActivityLogsRouter(bot: Bot<BotContext>): Router {
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

  router.post("/:id/undo", requireChatAdmin(), async (req: Request, res: Response) => {
    const chatId = Number(req.params.chatId);
    const id = req.params.id;

    try {
      const log = await activityLogRepository.findById(id);
      if (!log || log.chatId !== chatId) {
        res.status(404).json({ error: "log_not_found" });
        return;
      }
      if (log.undoneAt) {
        res.status(409).json({ error: "already_undone" });
        return;
      }
      if (!UNDOABLE.has(log.type)) {
        res.status(409).json({ error: "no_inverse" });
        return;
      }

      const actorInfo: ActorInfo = {
        userId: req.user!.userId,
        name: req.user!.name,
        username: req.user!.username,
      };
      const actorActivity = {
        id: req.user!.userId,
        name: req.user!.name,
        username: req.user!.username,
      };

      switch (log.type) {
        case "warn": {
          if (log.targetId === undefined || log.targetId === null) {
            res.status(409).json({ error: "no_inverse" });
            return;
          }
          const updated = await userRepository.decrementWarning(log.targetId, chatId);
          if (!updated) {
            res.status(404).json({ error: "user_not_found" });
            return;
          }
          recordActivity({
            chatId,
            type: "unwarn",
            source: "panel",
            actor: actorActivity,
            target: { id: updated.userId, name: updated.name, username: updated.username },
            warningsAfter: updated.warnings,
            reason: "deshacer aviso",
          });
          break;
        }

        case "silence": {
          if (log.targetId === undefined || log.targetId === null) {
            res.status(409).json({ error: "no_inverse" });
            return;
          }
          const chat = await chatRepository.findByChatId(chatId);
          if (!chat) {
            res.status(404).json({ error: "chat_not_found" });
            return;
          }
          await unsilenceUserViaApi(bot.api, chat, log.targetId, actorInfo);
          break;
        }

        case "ban":
        case "autoban": {
          if (log.targetId === undefined || log.targetId === null) {
            res.status(409).json({ error: "no_inverse" });
            return;
          }
          const chat = await chatRepository.findByChatId(chatId);
          if (!chat) {
            res.status(404).json({ error: "chat_not_found" });
            return;
          }
          await unbanUserViaApi(bot.api, chat, log.targetId, actorInfo);
          break;
        }

        case "feature_toggle": {
          // Owner-only: flipping a feature key affects the entire chat.
          if (!req.user!.isSuperAdmin) {
            const isTelegramOwner = await adminRepository.isOwner(req.user!.userId, chatId);
            const chat = await chatRepository.findByChatId(chatId);
            const isDelegated = chat?.delegatedOwnerId === req.user!.userId;
            if (!isTelegramOwner && !isDelegated) {
              res.status(403).json({ error: "forbidden" });
              return;
            }
          }
          const key = log.targetRef as keyof typeof chatFeatureKeys | undefined;
          if (!key) {
            res.status(409).json({ error: "no_inverse" });
            return;
          }
          const chat = await chatRepository.findByChatId(chatId);
          if (!chat) {
            res.status(404).json({ error: "chat_not_found" });
            return;
          }
          // Flip the value currently on the chat — undo means "set back to whatever it
          // wasn't last toggled to", which is just the inverse of the current state.
          const cur = chat.features[key as keyof typeof chat.features];
          if (typeof cur !== "boolean") {
            res.status(409).json({ error: "no_inverse" });
            return;
          }
          const next = !cur;
          await chatRepository.patchFeatures(chatId, { [key]: next });
          recordActivity({
            chatId,
            type: "feature_toggle",
            source: "panel",
            actor: actorActivity,
            targetRef: key,
            reason: `deshacer · ${next ? "activado" : "desactivado"}`,
          });
          break;
        }

        case "whitelist_add": {
          // reason discriminates link vs user. Link entries store the domain in
          // targetRef; user entries store the userId in targetId.
          if (log.reason === "enlace" && log.targetRef) {
            await chatRepository.removeLinkWhitelist(chatId, log.targetRef);
            recordActivity({
              chatId,
              type: "whitelist_remove",
              source: "panel",
              actor: actorActivity,
              targetRef: log.targetRef,
              reason: "enlace · deshacer",
            });
          } else if (log.targetId !== undefined && log.targetId !== null) {
            await chatRepository.removeSpamUserWhitelist(chatId, log.targetId);
            recordActivity({
              chatId,
              type: "whitelist_remove",
              source: "panel",
              actor: actorActivity,
              target: { id: log.targetId },
              reason: "usuario · deshacer",
            });
          } else {
            res.status(409).json({ error: "no_inverse" });
            return;
          }
          break;
        }

        case "combo_add": {
          if (
            log.targetId === undefined ||
            log.targetId === null ||
            !log.targetRef
          ) {
            res.status(409).json({ error: "no_inverse" });
            return;
          }
          const updated = await userDomainAllowanceRepository.removeDomain(
            log.targetId,
            chatId,
            log.targetRef
          );
          if (updated && updated.domains.length === 0) {
            await userDomainAllowanceRepository.removeAllForUser(log.targetId, chatId);
          }
          recordActivity({
            chatId,
            type: "combo_remove",
            source: "panel",
            actor: actorActivity,
            target: { id: log.targetId },
            targetRef: log.targetRef,
            reason: "deshacer",
          });
          break;
        }

        case "banned_word_add": {
          if (!log.targetRef) {
            res.status(409).json({ error: "no_inverse" });
            return;
          }
          const scope = log.topicId !== undefined && log.topicId !== null ? "topic" : "all";
          const ok = await bannedWordRepository.removeByWord(
            chatId,
            log.targetRef,
            scope,
            log.topicId ?? undefined
          );
          if (!ok) {
            res.status(404).json({ error: "banned_word_not_found" });
            return;
          }
          recordActivity({
            chatId,
            type: "banned_word_remove",
            source: "panel",
            actor: actorActivity,
            targetRef: log.targetRef,
            topicId: log.topicId ?? undefined,
            reason: "deshacer",
          });
          break;
        }

        case "owner_delegate": {
          // Mirrors POST /admins/delegate's permission: only the Telegram chat creator
          // (or super-admin) may revoke an owner delegation.
          if (!req.user!.isSuperAdmin) {
            const isTelegramOwner = await adminRepository.isOwner(req.user!.userId, chatId);
            if (!isTelegramOwner) {
              res.status(403).json({ error: "forbidden" });
              return;
            }
          }
          const chat = await chatRepository.findByChatId(chatId);
          if (!chat) {
            res.status(404).json({ error: "chat_not_found" });
            return;
          }
          const previous = chat.delegatedOwnerId ?? null;
          await chatRepository.setDelegatedOwner(chatId, null);
          if (previous !== null) {
            recordActivity({
              chatId,
              type: "owner_revoke",
              source: "panel",
              actor: actorActivity,
              target: { id: previous },
              reason: "deshacer",
            });
          }
          break;
        }

        default: {
          // Unreachable while UNDOABLE stays in sync with the switch.
          res.status(409).json({ error: "no_inverse" });
          return;
        }
      }

      await activityLogRepository.markUndone(id);
      logger.info({
        action: "activityLogs.undo",
        chatId,
        logId: id,
        logType: log.type,
        by: req.user!.userId,
      });
      res.status(204).end();
    } catch (err) {
      logger.error({ action: "activityLogs.undo", error: String(err), chatId, id });
      res.status(500).json({ error: "internal_error" });
    }
  });

  return router;
}

// Used only to constrain the `keyof` indexing on chat.features in the feature_toggle case
// — never instantiated.
declare const chatFeatureKeys: import("../../types").IChat["features"];
