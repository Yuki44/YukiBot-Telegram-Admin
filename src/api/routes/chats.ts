import { Router, Request, Response } from "express";
import { Bot } from "grammy";
import { authenticate } from "../middleware/authenticate";
import { requireChatAdmin } from "../middleware/requireChatAdmin";
import { chatRepository } from "../../db/repositories/chatRepository";
import { adminRepository } from "../../db/repositories/adminRepository";
import { User } from "../../db/models/User";
import { ActivityLog } from "../../db/models/ActivityLog";
import { BannedWord } from "../../db/models/BannedWord";
import { logger } from "../../utils/logger";
import { recordActivity } from "../../utils/activityLog";
import { BotContext, IChat } from "../../types";

const FEATURE_KEYS: ReadonlyArray<keyof IChat["features"]> = [
  "languageDetection",
  "topicFiltering",
  "autoBan",
  "autoWarnSpam",
  "promoSpamDetection",
  "bannedWordsEnforcement",
];

interface ChatSummaryDto {
  chatId: number;
  name: string;
  type: "topics" | "normal";
  isActive: boolean;
  role: "owner" | "admin" | "super";
  members: number | null;
  photoFileId: string | null;
}

function toSummary(chat: IChat, role: ChatSummaryDto["role"]): ChatSummaryDto {
  return {
    chatId: chat.chatId,
    name: chat.name,
    type: chat.type,
    isActive: chat.isActive,
    role,
    members: typeof chat.members === "number" ? chat.members : null,
    photoFileId: chat.photoFileId ?? null,
  };
}

// Match the User photo cadence: weekly recheck is enough for moderation-dashboard
// chrome and keeps Telegram API quota cheap.
const CHAT_META_RECHECK_MS = 7 * 24 * 60 * 60 * 1000;

function metaStale(at: Date | undefined | null): boolean {
  if (!at) return true;
  return Date.now() - at.getTime() > CHAT_META_RECHECK_MS;
}

/**
 * Fire-and-forget refresh of (members count, chat photo) from Telegram. Throttled
 * to weekly per field; failures are logged but never block the response.
 */
function refreshChatMetadata(bot: Bot<BotContext>, chat: IChat): void {
  if (metaStale(chat.membersCheckedAt)) {
    bot.api
      .getChatMemberCount(chat.chatId)
      .then((count) => chatRepository.setMembersCount(chat.chatId, count))
      .catch((err) => {
        logger.warn({ action: "chats.refreshMembers_failed", chatId: chat.chatId, error: String(err) });
      });
  }
  if (metaStale(chat.photoCheckedAt)) {
    bot.api
      .getChat(chat.chatId)
      .then((info) => {
        const photo = (info as { photo?: { small_file_id?: string } }).photo;
        return chatRepository.setPhoto(chat.chatId, photo?.small_file_id ?? null);
      })
      .catch((err) => {
        logger.warn({ action: "chats.refreshPhoto_failed", chatId: chat.chatId, error: String(err) });
      });
  }
}

export function createChatsRouter(bot: Bot<BotContext>): Router {
  const router = Router();

  router.use(authenticate);

  router.get("/", async (req: Request, res: Response) => {
    const user = req.user!;
    try {
      let chats: IChat[];
      let summaries: ChatSummaryDto[];
      if (user.isSuperAdmin) {
        chats = await chatRepository.listAll();
        summaries = chats.map((c) => toSummary(c, "super"));
      } else {
        const adminRecords = await adminRepository.findByUserId(user.userId);
        const chatIds = adminRecords.map((a) => a.chatId);
        const roleByChat = new Map(adminRecords.map((a) => [a.chatId, a.role]));
        chats = await chatRepository.listByChatIds(chatIds);
        summaries = chats.map((c) => {
          // Delegated owner shows as "owner" inside YukiBot even if Telegram says "admin".
          const baseRole = roleByChat.get(c.chatId) ?? "admin";
          const role = c.delegatedOwnerId === user.userId ? "owner" : baseRole;
          return toSummary(c, role);
        });
      }

      // Kick off (rate-limited) metadata refresh in the background — callers see
      // last-known values immediately and pick up fresh ones on the next load.
      for (const chat of chats) refreshChatMetadata(bot, chat);

      res.json(summaries);
    } catch (err) {
      logger.error({ action: "chats.list", error: String(err), userId: user.userId });
      res.status(500).json({ error: "internal_error" });
    }
  });

  router.get("/:chatId", requireChatAdmin(), async (req: Request, res: Response) => {
    const chatId = Number(req.params.chatId);
    const user = req.user!;
    try {
      const chat = await chatRepository.findByChatId(chatId);
      if (!chat) {
        res.status(404).json({ error: "chat_not_found" });
        return;
      }

      let role: ChatSummaryDto["role"];
      if (user.isSuperAdmin) {
        role = "super";
      } else if (chat.delegatedOwnerId === user.userId) {
        role = "owner";
      } else {
        const adminRecord = await adminRepository.findByUserId(user.userId);
        const here = adminRecord.find((a) => a.chatId === chatId);
        role = here?.role ?? "admin";
      }

      refreshChatMetadata(bot, chat);

      const obj = chat.toObject();
      res.json({
        ...obj,
        role,
        members: typeof chat.members === "number" ? chat.members : null,
        photoFileId: chat.photoFileId ?? null,
      });
    } catch (err) {
      logger.error({ action: "chats.detail", error: String(err), chatId });
      res.status(500).json({ error: "internal_error" });
    }
  });

  // Aggregate counts for the dashboard hero. `actionsToday` counts moderation
  // actions only — feature/list/team/topic config changes are excluded so the
  // number reflects "things YukiBot did to users today", not config noise.
  router.get("/:chatId/stats", requireChatAdmin(), async (req: Request, res: Response) => {
    const chatId = Number(req.params.chatId);
    try {
      const startOfToday = new Date();
      startOfToday.setHours(0, 0, 0, 0);

      const [warnedCount, silencedCount, bannedCount, actionsToday, bannedWordsCount] =
        await Promise.all([
          User.countDocuments({ chatId, warnings: { $gt: 0 }, isMuted: { $ne: true }, isBanned: { $ne: true } }),
          User.countDocuments({ chatId, isMuted: true, isBanned: { $ne: true } }),
          User.countDocuments({ chatId, isBanned: true }),
          ActivityLog.countDocuments({
            chatId,
            timestamp: { $gte: startOfToday },
            type: { $in: ["warn", "unwarn", "silence", "unsilence", "ban", "unban", "kick", "autoban", "pardon"] },
          }),
          BannedWord.countDocuments({ chatId }),
        ]);

      res.json({ warnedCount, silencedCount, bannedCount, actionsToday, bannedWordsCount });
    } catch (err) {
      logger.error({ action: "chats.stats", error: String(err), chatId });
      res.status(500).json({ error: "internal_error" });
    }
  });

  router.put(
    "/:chatId/features",
    requireChatAdmin({ ownerOnly: true }),
    async (req: Request, res: Response) => {
      const chatId = Number(req.params.chatId);
      const body = req.body as Record<string, unknown>;

      const partial: Partial<IChat["features"]> = {};
      for (const key of FEATURE_KEYS) {
        if (key in body) {
          if (typeof body[key] !== "boolean") {
            res.status(400).json({ error: "invalid_feature_value", key });
            return;
          }
          partial[key] = body[key] as boolean;
        }
      }

      try {
        const updated = await chatRepository.patchFeatures(chatId, partial);
        if (!updated) {
          res.status(404).json({ error: "chat_not_found" });
          return;
        }
        logger.info({
          action: "chats.features.update",
          chatId,
          userId: req.user!.userId,
          changed: Object.keys(partial),
        });
        for (const [key, value] of Object.entries(partial)) {
          recordActivity({
            chatId,
            type: "feature_toggle",
            source: "panel",
            actor: { id: req.user!.userId, name: req.user!.name, username: req.user!.username },
            targetRef: key,
            reason: value ? "activado" : "desactivado",
          });
        }
        res.json(updated.features);
      } catch (err) {
        logger.error({ action: "chats.features.update", error: String(err), chatId });
        res.status(500).json({ error: "internal_error" });
      }
    }
  );

  return router;
}
