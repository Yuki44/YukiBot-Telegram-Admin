import { Request, Response, NextFunction } from "express";
import { adminRepository } from "../../db/repositories/adminRepository";
import { chatRepository } from "../../db/repositories/chatRepository";
import { logger } from "../../utils/logger";

export interface RequireChatAdminOptions {
  ownerOnly?: boolean;
  /** When true, only the Telegram chat creator (Admin.role==='owner') passes — used for the delegation routes. */
  telegramOwnerOnly?: boolean;
}

export function requireChatAdmin(opts: RequireChatAdminOptions = {}) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const user = req.user;
    if (!user) {
      res.status(401).json({ error: "unauthenticated" });
      return;
    }

    const chatId = Number(req.params.chatId);
    if (!Number.isFinite(chatId)) {
      res.status(400).json({ error: "invalid_chat_id" });
      return;
    }

    // Super-admins (ADMIN_IDS) bypass per-chat checks entirely.
    if (user.isSuperAdmin) {
      next();
      return;
    }

    try {
      if (opts.telegramOwnerOnly) {
        const ok = await adminRepository.isOwner(user.userId, chatId);
        if (!ok) {
          res.status(403).json({ error: "forbidden" });
          return;
        }
        next();
        return;
      }

      if (opts.ownerOnly) {
        const isTelegramOwner = await adminRepository.isOwner(user.userId, chatId);
        if (isTelegramOwner) {
          next();
          return;
        }
        const chat = await chatRepository.findByChatId(chatId);
        if (chat && chat.delegatedOwnerId === user.userId) {
          next();
          return;
        }
        res.status(403).json({ error: "forbidden" });
        return;
      }

      const ok = await adminRepository.isChatAdmin(user.userId, chatId);
      if (!ok) {
        res.status(403).json({ error: "forbidden" });
        return;
      }
      next();
    } catch (err) {
      logger.error({ action: "requireChatAdmin", error: String(err), userId: user.userId, chatId });
      res.status(500).json({ error: "internal_error" });
    }
  };
}
