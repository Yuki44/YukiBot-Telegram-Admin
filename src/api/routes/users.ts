import { Router, Request, Response } from "express";
import { Bot } from "grammy";
import { authenticate } from "../middleware/authenticate";
import { requireChatAdmin } from "../middleware/requireChatAdmin";
import { userRepository, UserListFilter } from "../../db/repositories/userRepository";
import { chatRepository } from "../../db/repositories/chatRepository";
import { adminRepository } from "../../db/repositories/adminRepository";
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

      // Reconcile mute/ban state from Telegram's truth so the dashboard fixes any stale
      // DB rows (e.g. users silenced via /sil BEFORE the executeSilence persistence patch).
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
      const isAdmin = await adminRepository.isChatAdmin(userId, chatId);
      logger.info({
        action: "users.refresh",
        chatId,
        userId,
        by: req.user!.userId,
        muted: isMutedFromTg,
        banned: isBannedFromTg,
      });
      res.json(userToDto(updated, isAdmin));
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
