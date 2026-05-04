import { Router, Request, Response } from "express";
import { authenticate } from "../middleware/authenticate";
import { requireChatAdmin } from "../middleware/requireChatAdmin";
import { adminRepository } from "../../db/repositories/adminRepository";
import { chatRepository } from "../../db/repositories/chatRepository";
import { logger } from "../../utils/logger";
import { recordActivity } from "../../utils/activityLog";

interface AdminDto {
  userId: number;
  name: string;
  username: string;
  /** What Telegram itself records — chat creator vs. plain admin. */
  telegramRole: "owner" | "admin";
  /** True only when this user is the YukiBot-side delegated owner. */
  isDelegatedOwner: boolean;
}

interface AdminsResponse {
  admins: AdminDto[];
  delegatedOwnerId: number | null;
}

interface DelegateBody {
  userId?: number;
}

export function createAdminsRouter(): Router {
  const router = Router({ mergeParams: true });

  router.use(authenticate);

  router.get("/", requireChatAdmin(), async (req: Request, res: Response) => {
    const chatId = Number(req.params.chatId);
    try {
      const [chat, records] = await Promise.all([
        chatRepository.findByChatId(chatId),
        adminRepository.findByChatId(chatId),
      ]);
      if (!chat) {
        res.status(404).json({ error: "chat_not_found" });
        return;
      }
      const delegatedOwnerId = chat.delegatedOwnerId ?? null;
      const admins: AdminDto[] = records
        .map((r) => ({
          userId: r.userId,
          name: r.name,
          username: r.username,
          telegramRole: r.role,
          isDelegatedOwner: delegatedOwnerId !== null && r.userId === delegatedOwnerId,
        }))
        // Telegram creator first, delegated owner second, then alphabetical.
        .sort((a, b) => {
          if (a.telegramRole === "owner" && b.telegramRole !== "owner") return -1;
          if (b.telegramRole === "owner" && a.telegramRole !== "owner") return 1;
          if (a.isDelegatedOwner && !b.isDelegatedOwner) return -1;
          if (b.isDelegatedOwner && !a.isDelegatedOwner) return 1;
          return a.name.localeCompare(b.name, "es");
        });
      const body: AdminsResponse = { admins, delegatedOwnerId };
      res.json(body);
    } catch (err) {
      logger.error({ action: "admins.list", error: String(err), chatId });
      res.status(500).json({ error: "internal_error" });
    }
  });

  // Only the Telegram chat creator can grant or revoke YukiBot's owner delegation.
  // (Super-admins also pass via requireChatAdmin's bypass.)
  router.post(
    "/delegate",
    requireChatAdmin({ telegramOwnerOnly: true }),
    async (req: Request, res: Response) => {
      const chatId = Number(req.params.chatId);
      const body = req.body as DelegateBody;

      if (typeof body.userId !== "number" || !Number.isFinite(body.userId)) {
        res.status(400).json({ error: "invalid_user_id" });
        return;
      }

      try {
        const target = await adminRepository.findByUserId(body.userId);
        const here = target.find((a) => a.chatId === chatId);
        if (!here) {
          res.status(404).json({ error: "target_not_admin" });
          return;
        }
        // Refuse to delegate to the Telegram creator themselves — pointless.
        if (here.role === "owner") {
          res.status(400).json({ error: "target_is_creator" });
          return;
        }
        const updated = await chatRepository.setDelegatedOwner(chatId, body.userId);
        if (!updated) {
          res.status(404).json({ error: "chat_not_found" });
          return;
        }
        logger.info({
          action: "admins.delegate",
          chatId,
          targetId: body.userId,
          actorId: req.user!.userId,
        });
        recordActivity({
          chatId,
          type: "owner_delegate",
          source: "panel",
          actor: { id: req.user!.userId, name: req.user!.name, username: req.user!.username },
          target: { id: body.userId, name: here.name, username: here.username },
        });
        res.json({ delegatedOwnerId: body.userId });
      } catch (err) {
        logger.error({ action: "admins.delegate", error: String(err), chatId });
        res.status(500).json({ error: "internal_error" });
      }
    }
  );

  router.delete(
    "/delegate",
    requireChatAdmin({ telegramOwnerOnly: true }),
    async (req: Request, res: Response) => {
      const chatId = Number(req.params.chatId);
      try {
        const chat = await chatRepository.findByChatId(chatId);
        if (!chat) {
          res.status(404).json({ error: "chat_not_found" });
          return;
        }
        const previous = chat.delegatedOwnerId ?? null;
        await chatRepository.setDelegatedOwner(chatId, null);
        logger.info({
          action: "admins.revoke",
          chatId,
          previousId: previous,
          actorId: req.user!.userId,
        });
        if (previous !== null) {
          recordActivity({
            chatId,
            type: "owner_revoke",
            source: "panel",
            actor: { id: req.user!.userId, name: req.user!.name, username: req.user!.username },
            target: { id: previous },
          });
        }
        res.json({ delegatedOwnerId: null });
      } catch (err) {
        logger.error({ action: "admins.revoke", error: String(err), chatId });
        res.status(500).json({ error: "internal_error" });
      }
    }
  );

  return router;
}
