import { Router, Request, Response } from "express";
import { Bot } from "grammy";
import type { ChatMember } from "grammy/types";
import { authenticate } from "../middleware/authenticate";
import { requireChatAdmin } from "../middleware/requireChatAdmin";
import { userRepository, UserListFilter } from "../../db/repositories/userRepository";
import { chatRepository } from "../../db/repositories/chatRepository";
import { adminRepository } from "../../db/repositories/adminRepository";
import { messageRepository } from "../../db/repositories/messageRepository";
import { logger } from "../../utils/logger";
import { BotContext, IUser } from "../../types";
import {
  ActorInfo,
  banUserViaApi,
  pardonUserViaApi,
  silenceUserViaApi,
  unbanUserViaApi,
  unsilenceUserViaApi,
  warnUserViaApi,
} from "../services/userActions";

const VALID_FILTERS: UserListFilter[] = ["all", "warned", "silenced", "banned"];

function userToDto(u: IUser, isAdmin = false) {
  return {
    userId: u.userId,
    chatId: u.chatId,
    username: u.username,
    name: u.name,
    warnings: u.warnings,
    warningReasons: u.warningReasons,
    isMuted: u.isMuted,
    muteUntil: u.muteUntil ? u.muteUntil.toISOString() : null,
    isBanned: u.isBanned,
    wasBanned: u.wasBanned,
    isAdmin,
    // null = checked, no photo. undefined = never checked (photo discovery hasn't run).
    photoFileId: u.photoFileId ?? null,
  };
}

/** Returns the set of userIds that are admins of the given chat. */
async function adminIdSet(chatId: number): Promise<Set<number>> {
  const admins = await adminRepository.findByChatId(chatId);
  return new Set(admins.map((a) => a.userId));
}

function actorFromReq(req: Request): ActorInfo {
  const user = req.user!;
  return { userId: user.userId, name: user.name, username: user.username };
}

export function createUsersRouter(bot: Bot<BotContext>): Router {
  const router = Router({ mergeParams: true });

  router.use(authenticate);

  router.get("/", requireChatAdmin(), async (req: Request, res: Response) => {
    const chatId = Number(req.params.chatId);
    const filterRaw = (req.query.filter as string) ?? "all";
    const filter: UserListFilter = VALID_FILTERS.includes(filterRaw as UserListFilter)
      ? (filterRaw as UserListFilter)
      : "all";
    const q = typeof req.query.q === "string" ? req.query.q.trim() : "";

    try {
      const [users, admins] = await Promise.all([
        userRepository.listByChatId(chatId, { filter, q: q || undefined }),
        adminIdSet(chatId),
      ]);
      res.json(users.map((u) => userToDto(u, admins.has(u.userId))));
    } catch (err) {
      logger.error({ action: "users.list", error: String(err), chatId });
      res.status(500).json({ error: "internal_error" });
    }
  });

  router.get("/:userId/stats", requireChatAdmin(), async (req: Request, res: Response) => {
    const chatId = Number(req.params.chatId);
    const userId = Number(req.params.userId);
    if (!Number.isFinite(userId)) {
      res.status(400).json({ error: "invalid_user_id" });
      return;
    }
    try {
      const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const messagesLast30d = await messageRepository.countSince(userId, chatId, since);
      res.json({ messagesLast30d });
    } catch (err) {
      logger.error({ action: "users.stats", error: String(err), chatId, userId });
      res.status(500).json({ error: "internal_error" });
    }
  });

  router.get("/:userId", requireChatAdmin(), async (req: Request, res: Response) => {
    const chatId = Number(req.params.chatId);
    const userId = Number(req.params.userId);
    if (!Number.isFinite(userId)) {
      res.status(400).json({ error: "invalid_user_id" });
      return;
    }
    try {
      const user = await userRepository.findByUserAndChat(userId, chatId);
      if (!user) {
        res.status(404).json({ error: "user_not_found" });
        return;
      }
      const isAdmin = await adminRepository.isChatAdmin(userId, chatId);
      res.json(userToDto(user, isAdmin));
    } catch (err) {
      logger.error({ action: "users.detail", error: String(err), chatId, userId });
      res.status(500).json({ error: "internal_error" });
    }
  });

  // ─── Action endpoints ────────────────────────────────────────────────

  async function loadChatOr404(chatId: number, res: Response) {
    const chat = await chatRepository.findByChatId(chatId);
    if (!chat) {
      res.status(404).json({ error: "chat_not_found" });
      return null;
    }
    return chat;
  }

  /** Returns true if the request was rejected (target is admin). */
  async function rejectIfTargetIsAdmin(
    chatId: number,
    targetUserId: number,
    res: Response
  ): Promise<boolean> {
    if (await adminRepository.isChatAdmin(targetUserId, chatId)) {
      res.status(403).json({ error: "target_is_admin" });
      return true;
    }
    return false;
  }

  router.post("/:userId/warn", requireChatAdmin(), async (req: Request, res: Response) => {
    const chatId = Number(req.params.chatId);
    const userId = Number(req.params.userId);
    const reason = (req.body?.reason as string) || "Acción desde el panel";

    try {
      const chat = await loadChatOr404(chatId, res);
      if (!chat) return;
      if (await rejectIfTargetIsAdmin(chatId, userId, res)) return;
      const result = await warnUserViaApi(bot.api, chat, userId, actorFromReq(req), reason);
      res.json({ user: userToDto(result.user), enforced: result.enforced, enforceError: result.enforceError });
    } catch (err) {
      logger.error({ action: "users.warn", error: String(err), chatId, userId });
      res.status(500).json({ error: "internal_error" });
    }
  });

  router.post("/:userId/silence", requireChatAdmin(), async (req: Request, res: Response) => {
    const chatId = Number(req.params.chatId);
    const userId = Number(req.params.userId);
    try {
      const chat = await loadChatOr404(chatId, res);
      if (!chat) return;
      if (await rejectIfTargetIsAdmin(chatId, userId, res)) return;
      const result = await silenceUserViaApi(bot.api, chat, userId, actorFromReq(req));
      res.json({ user: userToDto(result.user), enforced: result.enforced, enforceError: result.enforceError });
    } catch (err) {
      logger.error({ action: "users.silence", error: String(err), chatId, userId });
      res.status(500).json({ error: "internal_error" });
    }
  });

  router.post("/:userId/unsilence", requireChatAdmin(), async (req: Request, res: Response) => {
    const chatId = Number(req.params.chatId);
    const userId = Number(req.params.userId);
    try {
      const chat = await loadChatOr404(chatId, res);
      if (!chat) return;
      const result = await unsilenceUserViaApi(bot.api, chat, userId, actorFromReq(req));
      res.json({ user: userToDto(result.user), enforced: result.enforced, enforceError: result.enforceError });
    } catch (err) {
      logger.error({ action: "users.unsilence", error: String(err), chatId, userId });
      res.status(500).json({ error: "internal_error" });
    }
  });

  router.post("/:userId/ban", requireChatAdmin(), async (req: Request, res: Response) => {
    const chatId = Number(req.params.chatId);
    const userId = Number(req.params.userId);
    const reason = (req.body?.reason as string) || undefined;
    try {
      const chat = await loadChatOr404(chatId, res);
      if (!chat) return;
      if (await rejectIfTargetIsAdmin(chatId, userId, res)) return;
      const result = await banUserViaApi(bot.api, chat, userId, actorFromReq(req), reason);
      res.json({ user: userToDto(result.user), enforced: result.enforced, enforceError: result.enforceError });
    } catch (err) {
      logger.error({ action: "users.ban", error: String(err), chatId, userId });
      res.status(500).json({ error: "internal_error" });
    }
  });

  router.post("/:userId/unban", requireChatAdmin(), async (req: Request, res: Response) => {
    const chatId = Number(req.params.chatId);
    const userId = Number(req.params.userId);
    try {
      const chat = await loadChatOr404(chatId, res);
      if (!chat) return;
      const result = await unbanUserViaApi(bot.api, chat, userId, actorFromReq(req));
      res.json({ user: userToDto(result.user), enforced: result.enforced, enforceError: result.enforceError });
    } catch (err) {
      logger.error({ action: "users.unban", error: String(err), chatId, userId });
      res.status(500).json({ error: "internal_error" });
    }
  });

  // Re-check the cached photoFileId at most once per week. Telegram doesn't expose a
  // change feed for profile photos, but checking too often burns API quota; weekly
  // strikes a balance for a moderation dashboard.
  const PHOTO_RECHECK_MS = 7 * 24 * 60 * 60 * 1000;

  /**
   * Cache the smallest available profile-photo file_id for a user. Stores `null` if
   * the user has no photo (or the bot can't see it) so we don't re-call the API on
   * every avatar render.
   */
  async function discoverProfilePhoto(userId: number, chatId: number): Promise<void> {
    try {
      const photos = await bot.api.getUserProfilePhotos(userId, { limit: 1 });
      // photos.photos is PhotoSize[][] — outer array is "photos" (we asked for 1),
      // inner array is the same photo at multiple resolutions, smallest first.
      const smallest = photos.photos[0]?.[0];
      const fileId = smallest?.file_id ?? null;

      await userRepository.upsert({
        userId,
        chatId,
        photoFileId: fileId,
        photoCheckedAt: new Date(),
      });
    } catch (err) {
      logger.warn({ action: "users.discoverPhoto_failed", chatId, userId, error: String(err) });
    }
  }

  function shouldRecheckPhoto(u: IUser): boolean {
    if (!u.photoCheckedAt) return true;
    return Date.now() - u.photoCheckedAt.getTime() > PHOTO_RECHECK_MS;
  }

  /**
   * Reconcile a single user's mute/ban state from a Telegram ChatMember response.
   * Returns the updated user and whether anything actually changed (caller decides
   * whether to log/report).
   */
  async function reconcileFromMember(
    chatId: number,
    member: ChatMember,
    previous: IUser | null
  ): Promise<{ user: IUser; changed: boolean }> {
    const isMutedFromTg =
      member.status === "restricted" && (member as { can_send_messages?: boolean }).can_send_messages === false;
    const isBannedFromTg = member.status === "kicked";
    const muteUntilFromTg =
      isMutedFromTg && typeof (member as { until_date?: number }).until_date === "number"
        ? new Date((member as { until_date: number }).until_date * 1000)
        : undefined;

    const fresh: Partial<IUser> = {
      userId: member.user.id,
      chatId,
      username: member.user.username,
      name:
        [member.user.first_name, member.user.last_name].filter(Boolean).join(" ") ||
        member.user.username ||
        undefined,
      isMuted: isMutedFromTg,
      muteUntil: muteUntilFromTg,
      isBanned: isBannedFromTg,
    };
    // wasBanned must NEVER revert to false (G3) — only set it true if Telegram says banned.
    if (isBannedFromTg) fresh.wasBanned = true;

    const updated = await userRepository.upsert(fresh);

    const changed =
      !previous ||
      Boolean(previous.isMuted) !== isMutedFromTg ||
      Boolean(previous.isBanned) !== isBannedFromTg;

    return { user: updated, changed };
  }

  router.post("/:userId/refresh", requireChatAdmin(), async (req: Request, res: Response) => {
    const chatId = Number(req.params.chatId);
    const userId = Number(req.params.userId);
    try {
      const member = await bot.api.getChatMember(chatId, userId).catch((err: unknown) => {
        logger.warn({
          action: "users.refresh.getChatMember_failed",
          error: String(err),
          chatId,
          userId,
        });
        return null;
      });

      if (!member) {
        res.status(404).json({ error: "telegram_member_not_found" });
        return;
      }

      const previous = await userRepository.findByUserAndChat(userId, chatId);
      const { user: updated } = await reconcileFromMember(chatId, member, previous);
      if (shouldRecheckPhoto(updated)) {
        await discoverProfilePhoto(userId, chatId);
      }
      const final = (await userRepository.findByUserAndChat(userId, chatId)) ?? updated;
      const isAdmin = await adminRepository.isChatAdmin(userId, chatId);
      logger.info({
        action: "users.refresh",
        chatId,
        userId,
        by: req.user!.userId,
        muted: final.isMuted,
        banned: final.isBanned,
      });
      res.json(userToDto(final, isAdmin));
    } catch (err) {
      logger.error({ action: "users.refresh", error: String(err), chatId, userId });
      res.status(500).json({ error: "internal_error" });
    }
  });

  router.post(
    "/:userId/pardon",
    requireChatAdmin({ ownerOnly: true }),
    async (req: Request, res: Response) => {
      const chatId = Number(req.params.chatId);
      const userId = Number(req.params.userId);
      try {
        await pardonUserViaApi(chatId, userId, actorFromReq(req));
        logger.info({ action: "users.pardon", chatId, userId, by: req.user!.userId });
        res.status(204).end();
      } catch (err) {
        logger.error({ action: "users.pardon", error: String(err), chatId, userId });
        res.status(500).json({ error: "internal_error" });
      }
    }
  );

  return router;
}
