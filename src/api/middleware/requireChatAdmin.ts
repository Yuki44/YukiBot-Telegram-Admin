import { Request, Response, NextFunction } from "express";
import { adminRepository } from "../../db/repositories/adminRepository";
import { logger } from "../../utils/logger";

export interface RequireChatAdminOptions {
  ownerOnly?: boolean;
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
      const ok = opts.ownerOnly
        ? await adminRepository.isOwner(user.userId, chatId)
        : await adminRepository.isChatAdmin(user.userId, chatId);
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
