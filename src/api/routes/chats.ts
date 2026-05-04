import { Router, Request, Response } from "express";
import { authenticate } from "../middleware/authenticate";
import { requireChatAdmin } from "../middleware/requireChatAdmin";
import { chatRepository } from "../../db/repositories/chatRepository";
import { adminRepository } from "../../db/repositories/adminRepository";
import { logger } from "../../utils/logger";
import { recordActivity } from "../../utils/activityLog";
import { IChat } from "../../types";

const FEATURE_KEYS: ReadonlyArray<keyof IChat["features"]> = [
  "languageDetection",
  "spamDetection",
  "topicFiltering",
  "commands",
  "autoBan",
  "autoWarnSpam",
  "promoSpamDetection",
];

interface ChatSummaryDto {
  chatId: number;
  name: string;
  type: "topics" | "normal";
  isActive: boolean;
  role: "owner" | "admin" | "super";
}

function toSummary(chat: IChat, role: ChatSummaryDto["role"]): ChatSummaryDto {
  return {
    chatId: chat.chatId,
    name: chat.name,
    type: chat.type,
    isActive: chat.isActive,
    role,
  };
}

export function createChatsRouter(): Router {
  const router = Router();

  router.use(authenticate);

  router.get("/", async (req: Request, res: Response) => {
    const user = req.user!;
    try {
      if (user.isSuperAdmin) {
        const chats = await chatRepository.listAll();
        res.json(chats.map((c) => toSummary(c, "super")));
        return;
      }

      const adminRecords = await adminRepository.findByUserId(user.userId);
      const chatIds = adminRecords.map((a) => a.chatId);
      const roleByChat = new Map(adminRecords.map((a) => [a.chatId, a.role]));
      const chats = await chatRepository.listByChatIds(chatIds);
      res.json(
        chats.map((c) => {
          // Delegated owner shows as "owner" inside YukiBot even if Telegram says "admin".
          const baseRole = roleByChat.get(c.chatId) ?? "admin";
          const role = c.delegatedOwnerId === user.userId ? "owner" : baseRole;
          return toSummary(c, role);
        })
      );
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

      res.json({ ...chat.toObject(), role });
    } catch (err) {
      logger.error({ action: "chats.detail", error: String(err), chatId });
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
