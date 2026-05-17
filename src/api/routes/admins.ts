import { Router, Request, Response } from "express";
import { Bot } from "grammy";
import { authenticate } from "../middleware/authenticate";
import { requireChatAdmin } from "../middleware/requireChatAdmin";
import { adminRepository } from "../../db/repositories/adminRepository";
import { chatRepository } from "../../db/repositories/chatRepository";
import { userRepository } from "../../db/repositories/userRepository";
import { discoverProfilePhoto, shouldRecheckPhoto } from "../../bot/helpers/profilePhoto";
import { BotContext } from "../../types";
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
  /** Display-only opt-in: this admin chose to be hidden in the dashboard list. */
  hiddenInAdminList: boolean;
  /** Cached Telegram profile photo file_id, when known via the User collection. */
  photoFileId: string | null;
}

interface AdminsResponse {
  admins: AdminDto[];
  delegatedOwnerId: number | null;
}

interface DelegateBody {
  userId?: number;
}

export function createAdminsRouter(bot: Bot<BotContext>): Router {
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
      const hiddenSet = new Set(chat.hiddenAdminIds ?? []);

      // Pull photo file_ids from the User collection so admins get the same avatars
      // as the rest of the dashboard. Admins are users like any other — but one who
      // has never messaged here won't have a User row yet, and one added after /setup
      // never had discoverProfilePhoto run. So for any admin whose row is missing or
      // whose cached photo is stale, discover it now (the weekly recheck guard inside
      // shouldRecheckPhoto keeps this from hitting the Telegram API on every render).
      // discoverProfilePhoto upserts a User row, which also means the admin gains a
      // record so their detail page resolves when clicked from the dashboard.
      const initialLookups = await Promise.all(
        records.map((r) => userRepository.findByUserAndChat(r.userId, chatId))
      );
      await Promise.all(
        records.map(async (r, idx) => {
          const u = initialLookups[idx];
          if (!u || shouldRecheckPhoto(u)) {
            await discoverProfilePhoto(bot.api, r.userId, chatId);
          }
        })
      );
      const photoLookups = await Promise.all(
        records.map((r) => userRepository.findByUserAndChat(r.userId, chatId))
      );
      const photoByUserId = new Map<number, string | null>();
      photoLookups.forEach((u, idx) => {
        if (u) photoByUserId.set(records[idx].userId, u.photoFileId ?? null);
      });

      const admins: AdminDto[] = records
        .map((r) => ({
          userId: r.userId,
          name: r.name,
          username: r.username,
          telegramRole: r.role,
          isDelegatedOwner: delegatedOwnerId !== null && r.userId === delegatedOwnerId,
          hiddenInAdminList: hiddenSet.has(r.userId),
          photoFileId: photoByUserId.get(r.userId) ?? null,
        }))
        // Telegram creator first, delegated owner second, then alphabetical.
        .sort((a, b) => {
          if (a.telegramRole === "owner" && b.telegramRole !== "owner") return -1;
          if (b.telegramRole === "owner" && a.telegramRole !== "owner") return 1;
          if (a.isDelegatedOwner && !b.isDelegatedOwner) return -1;
          if (b.isDelegatedOwner && !a.isDelegatedOwner) return 1;
          return a.name.localeCompare(b.name, "es");
        });

      // An admin who hid themselves must not appear to other admins. The hidden
      // user still receives their own row (so the eye state renders and they can
      // unhide), and super-admins see everyone for support.
      const viewerId = req.user!.userId;
      const isSuperAdmin = req.user!.isSuperAdmin === true;
      const visibleAdmins = admins.filter(
        (a) => !a.hiddenInAdminList || a.userId === viewerId || isSuperAdmin
      );

      const body: AdminsResponse = { admins: visibleAdmins, delegatedOwnerId };
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

  // Per-admin display-only visibility toggle. Currently scoped to "self-hide for the
  // owner": the logged-in user can only flip their own row, and must be the Telegram
  // chat creator (or a super-admin via the global bypass). Display-only — Telegram's
  // own admin list is not affected.
  router.post("/:userId/visibility", requireChatAdmin(), async (req: Request, res: Response) => {
    const chatId = Number(req.params.chatId);
    const userId = Number(req.params.userId);
    if (!Number.isFinite(userId)) {
      res.status(400).json({ error: "invalid_user_id" });
      return;
    }

    const actor = req.user!;
    const isSelf = actor.userId === userId;
    const isTelegramOwner = await adminRepository.isOwner(actor.userId, chatId);
    const allowed = actor.isSuperAdmin || (isSelf && isTelegramOwner);
    if (!allowed) {
      res.status(403).json({ error: "forbidden" });
      return;
    }

    const hiddenRaw = (req.body as { hidden?: unknown })?.hidden;
    if (typeof hiddenRaw !== "boolean") {
      res.status(400).json({ error: "invalid_hidden_flag" });
      return;
    }

    try {
      const updated = await chatRepository.setAdminVisibility(chatId, userId, hiddenRaw);
      if (!updated) {
        res.status(404).json({ error: "chat_not_found" });
        return;
      }
      logger.info({
        action: "admins.visibility",
        chatId,
        userId,
        hidden: hiddenRaw,
        by: actor.userId,
      });
      res.json({
        userId,
        hiddenInAdminList: hiddenRaw,
      });
    } catch (err) {
      logger.error({ action: "admins.visibility", error: String(err), chatId, userId });
      res.status(500).json({ error: "internal_error" });
    }
  });

  return router;
}
