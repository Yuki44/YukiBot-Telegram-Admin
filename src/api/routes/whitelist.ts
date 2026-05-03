import { Router, Request, Response } from "express";
import { authenticate } from "../middleware/authenticate";
import { requireChatAdmin } from "../middleware/requireChatAdmin";
import { chatRepository } from "../../db/repositories/chatRepository";
import { userRepository } from "../../db/repositories/userRepository";
import { userDomainAllowanceRepository } from "../../db/repositories/userDomainAllowanceRepository";
import { logger } from "../../utils/logger";
import { recordActivity } from "../../utils/activityLog";

/** Match the bot's wlLinks.parseDomain so the dashboard can't add invalid entries. */
function parseDomain(input: string): string | null {
  const trimmed = input
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split("/")[0];
  if (!trimmed || trimmed.length < 3) return null;
  return trimmed;
}

export function createWhitelistRouter(): Router {
  const router = Router({ mergeParams: true });

  router.use(authenticate);

  // ─── Link whitelist ─────────────────────────────────────────────────

  router.get("/links", requireChatAdmin(), async (req: Request, res: Response) => {
    const chatId = Number(req.params.chatId);
    try {
      const chat = await chatRepository.findByChatId(chatId);
      if (!chat) {
        res.status(404).json({ error: "chat_not_found" });
        return;
      }
      res.json(chat.linkWhitelist ?? []);
    } catch (err) {
      logger.error({ action: "whitelist.links.list", error: String(err), chatId });
      res.status(500).json({ error: "internal_error" });
    }
  });

  router.post("/links", requireChatAdmin(), async (req: Request, res: Response) => {
    const chatId = Number(req.params.chatId);
    const raw = (req.body?.domain as string) ?? "";
    const domain = parseDomain(raw);
    if (!domain) {
      res.status(400).json({ error: "invalid_domain" });
      return;
    }
    try {
      const updated = await chatRepository.addLinkWhitelist(chatId, domain);
      if (!updated) {
        res.status(404).json({ error: "chat_not_found" });
        return;
      }
      logger.info({
        action: "whitelist.links.add",
        chatId,
        domain,
        userId: req.user!.userId,
      });
      recordActivity({
        chatId,
        type: "whitelist_add",
        source: "panel",
        actor: { id: req.user!.userId, name: req.user!.name, username: req.user!.username },
        targetRef: domain,
        reason: "enlace",
      });
      res.json(updated.linkWhitelist ?? []);
    } catch (err) {
      logger.error({ action: "whitelist.links.add", error: String(err), chatId, domain });
      res.status(500).json({ error: "internal_error" });
    }
  });

  router.delete("/links/:domain", requireChatAdmin(), async (req: Request, res: Response) => {
    const chatId = Number(req.params.chatId);
    const domain = decodeURIComponent(req.params.domain);
    try {
      const updated = await chatRepository.removeLinkWhitelist(chatId, domain);
      if (!updated) {
        res.status(404).json({ error: "chat_not_found" });
        return;
      }
      logger.info({
        action: "whitelist.links.remove",
        chatId,
        domain,
        userId: req.user!.userId,
      });
      recordActivity({
        chatId,
        type: "whitelist_remove",
        source: "panel",
        actor: { id: req.user!.userId, name: req.user!.name, username: req.user!.username },
        targetRef: domain,
        reason: "enlace",
      });
      res.json(updated.linkWhitelist ?? []);
    } catch (err) {
      logger.error({ action: "whitelist.links.remove", error: String(err), chatId, domain });
      res.status(500).json({ error: "internal_error" });
    }
  });

  // ─── Spam-user whitelist ────────────────────────────────────────────

  router.get("/users", requireChatAdmin(), async (req: Request, res: Response) => {
    const chatId = Number(req.params.chatId);
    try {
      const chat = await chatRepository.findByChatId(chatId);
      if (!chat) {
        res.status(404).json({ error: "chat_not_found" });
        return;
      }
      res.json(chat.spamUserWhitelist ?? []);
    } catch (err) {
      logger.error({ action: "whitelist.users.list", error: String(err), chatId });
      res.status(500).json({ error: "internal_error" });
    }
  });

  router.post("/users", requireChatAdmin(), async (req: Request, res: Response) => {
    const chatId = Number(req.params.chatId);
    const userId = Number(req.body?.userId);
    if (!Number.isFinite(userId) || userId <= 0) {
      res.status(400).json({ error: "invalid_user_id" });
      return;
    }
    try {
      const updated = await chatRepository.addSpamUserWhitelist(chatId, userId);
      if (!updated) {
        res.status(404).json({ error: "chat_not_found" });
        return;
      }
      logger.info({
        action: "whitelist.users.add",
        chatId,
        targetUserId: userId,
        userId: req.user!.userId,
      });
      recordActivity({
        chatId,
        type: "whitelist_add",
        source: "panel",
        actor: { id: req.user!.userId, name: req.user!.name, username: req.user!.username },
        target: { id: userId },
        reason: "usuario",
      });
      res.json(updated.spamUserWhitelist ?? []);
    } catch (err) {
      logger.error({ action: "whitelist.users.add", error: String(err), chatId });
      res.status(500).json({ error: "internal_error" });
    }
  });

  router.delete("/users/:userId", requireChatAdmin(), async (req: Request, res: Response) => {
    const chatId = Number(req.params.chatId);
    const userId = Number(req.params.userId);
    if (!Number.isFinite(userId)) {
      res.status(400).json({ error: "invalid_user_id" });
      return;
    }
    try {
      const updated = await chatRepository.removeSpamUserWhitelist(chatId, userId);
      if (!updated) {
        res.status(404).json({ error: "chat_not_found" });
        return;
      }
      logger.info({
        action: "whitelist.users.remove",
        chatId,
        targetUserId: userId,
        userId: req.user!.userId,
      });
      recordActivity({
        chatId,
        type: "whitelist_remove",
        source: "panel",
        actor: { id: req.user!.userId, name: req.user!.name, username: req.user!.username },
        target: { id: userId },
        reason: "usuario",
      });
      res.json(updated.spamUserWhitelist ?? []);
    } catch (err) {
      logger.error({ action: "whitelist.users.remove", error: String(err), chatId });
      res.status(500).json({ error: "internal_error" });
    }
  });

  // ─── Mixtos: per-user domain allowances ─────────────────────────────

  router.get("/combo", requireChatAdmin(), async (req: Request, res: Response) => {
    const chatId = Number(req.params.chatId);
    try {
      const entries = await userDomainAllowanceRepository.findByChatId(chatId);
      // Hydrate with user identity (best-effort) so the UI can render avatars + names.
      const dtos = await Promise.all(
        entries.map(async (e) => {
          const u = await userRepository.findByUserAndChat(e.userId, chatId).catch(() => null);
          return {
            userId: e.userId,
            chatId: e.chatId,
            name: u?.name ?? null,
            username: u?.username ?? null,
            domains: e.domains,
          };
        })
      );
      res.json(dtos);
    } catch (err) {
      logger.error({ action: "whitelist.combo.list", error: String(err), chatId });
      res.status(500).json({ error: "internal_error" });
    }
  });

  router.post("/combo/:userId/domains", requireChatAdmin(), async (req: Request, res: Response) => {
    const chatId = Number(req.params.chatId);
    const userId = Number(req.params.userId);
    const raw = (req.body?.domain as string) ?? "";
    const domain = parseDomain(raw);
    if (!Number.isFinite(userId) || userId <= 0) {
      res.status(400).json({ error: "invalid_user_id" });
      return;
    }
    if (!domain) {
      res.status(400).json({ error: "invalid_domain" });
      return;
    }
    try {
      const updated = await userDomainAllowanceRepository.addDomain(userId, chatId, domain);
      logger.info({
        action: "whitelist.combo.add",
        chatId,
        targetUserId: userId,
        domain,
        userId: req.user!.userId,
      });
      recordActivity({
        chatId,
        type: "combo_add",
        source: "panel",
        actor: { id: req.user!.userId, name: req.user!.name, username: req.user!.username },
        target: { id: userId },
        targetRef: domain,
      });
      res.json({ userId, chatId, domains: updated.domains });
    } catch (err) {
      logger.error({ action: "whitelist.combo.add", error: String(err), chatId });
      res.status(500).json({ error: "internal_error" });
    }
  });

  router.delete(
    "/combo/:userId/domains/:domain",
    requireChatAdmin(),
    async (req: Request, res: Response) => {
      const chatId = Number(req.params.chatId);
      const userId = Number(req.params.userId);
      const domain = decodeURIComponent(req.params.domain);
      try {
        const updated = await userDomainAllowanceRepository.removeDomain(userId, chatId, domain);
        if (!updated) {
          res.status(404).json({ error: "combo_entry_not_found" });
          return;
        }
        // If the user has no domains left, remove the entry entirely so the list stays clean.
        if (updated.domains.length === 0) {
          await userDomainAllowanceRepository.removeAllForUser(userId, chatId);
        }
        logger.info({
          action: "whitelist.combo.remove",
          chatId,
          targetUserId: userId,
          domain,
          userId: req.user!.userId,
        });
        recordActivity({
          chatId,
          type: "combo_remove",
          source: "panel",
          actor: { id: req.user!.userId, name: req.user!.name, username: req.user!.username },
          target: { id: userId },
          targetRef: domain,
        });
        res.json({ userId, chatId, domains: updated.domains });
      } catch (err) {
        logger.error({ action: "whitelist.combo.remove", error: String(err), chatId });
        res.status(500).json({ error: "internal_error" });
      }
    }
  );

  router.delete("/combo/:userId", requireChatAdmin(), async (req: Request, res: Response) => {
    const chatId = Number(req.params.chatId);
    const userId = Number(req.params.userId);
    try {
      await userDomainAllowanceRepository.removeAllForUser(userId, chatId);
      logger.info({
        action: "whitelist.combo.removeAll",
        chatId,
        targetUserId: userId,
        userId: req.user!.userId,
      });
      res.status(204).end();
    } catch (err) {
      logger.error({ action: "whitelist.combo.removeAll", error: String(err), chatId });
      res.status(500).json({ error: "internal_error" });
    }
  });

  return router;
}
