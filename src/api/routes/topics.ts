import { Router, Request, Response } from "express";
import { authenticate } from "../middleware/authenticate";
import { requireChatAdmin } from "../middleware/requireChatAdmin";
import { topicRepository } from "../../db/repositories/topicRepository";
import { logger } from "../../utils/logger";
import { recordActivity } from "../../utils/activityLog";
import { VALID_CONTENT_TYPES } from "../../types";

const VALID_SET = new Set<string>(VALID_CONTENT_TYPES.map(String));

interface TopicBody {
  topicId?: number;
  name?: string;
  allowedMsgTypes?: string[];
  adminOnly?: boolean;
}

function sanitizeTypes(types: unknown): string[] | null {
  if (!Array.isArray(types)) return null;
  const out: string[] = [];
  for (const t of types) {
    if (typeof t !== "string") return null;
    if (!VALID_SET.has(t)) return null;
    if (!out.includes(t)) out.push(t);
  }
  return out;
}

export function createTopicsRouter(): Router {
  // mergeParams so we can read :chatId from the parent path
  const router = Router({ mergeParams: true });

  router.use(authenticate);

  router.get("/", requireChatAdmin(), async (req: Request, res: Response) => {
    const chatId = Number(req.params.chatId);
    try {
      const topics = await topicRepository.findAllByChatId(chatId);
      res.json(
        topics
          .map((t) => ({
            chatId: t.chatId,
            topicId: t.topicId,
            name: t.name,
            allowedMsgTypes: t.allowedMsgTypes,
            adminOnly: t.adminOnly ?? false,
            isUserConfigured: t.isUserConfigured ?? false,
          }))
          .sort((a, b) => a.topicId - b.topicId)
      );
    } catch (err) {
      logger.error({ action: "topics.list", error: String(err), chatId });
      res.status(500).json({ error: "internal_error" });
    }
  });

  router.post("/", requireChatAdmin({ ownerOnly: true }), async (req: Request, res: Response) => {
    const chatId = Number(req.params.chatId);
    const body = req.body as TopicBody;

    if (typeof body.topicId !== "number" || !Number.isFinite(body.topicId)) {
      res.status(400).json({ error: "invalid_topic_id" });
      return;
    }
    // Name is optional — the bot fills it in automatically from forum_topic_created /
    // forum_topic_edited events. Defaults to empty string; UI shows "Tema #ID" when empty.
    const name = (body.name ?? "").toString().trim();
    const allowedMsgTypes = sanitizeTypes(body.allowedMsgTypes ?? []);
    if (allowedMsgTypes === null) {
      res.status(400).json({ error: "invalid_allowed_types" });
      return;
    }

    const adminOnly = typeof body.adminOnly === "boolean" ? body.adminOnly : false;

    try {
      const created = await topicRepository.upsert({
        chatId,
        topicId: body.topicId,
        name,
        allowedMsgTypes,
        adminOnly,
      });
      logger.info({
        action: "topics.upsert",
        chatId,
        topicId: body.topicId,
        userId: req.user!.userId,
      });
      recordActivity({
        chatId,
        type: "topic_rule_change",
        source: "panel",
        actor: { id: req.user!.userId, name: req.user!.name, username: req.user!.username },
        targetRef: created.name?.trim() || `Tema #${created.topicId}`,
        topicId: created.topicId,
        reason: `tipos: ${allowedMsgTypes.join(", ") || "ninguno"}${adminOnly ? " · solo admins" : ""}`,
      });
      res.json({
        chatId: created.chatId,
        topicId: created.topicId,
        name: created.name,
        allowedMsgTypes: created.allowedMsgTypes,
        adminOnly: created.adminOnly ?? false,
        isUserConfigured: created.isUserConfigured ?? true,
      });
    } catch (err) {
      logger.error({ action: "topics.upsert", error: String(err), chatId });
      res.status(500).json({ error: "internal_error" });
    }
  });

  router.put(
    "/:topicId",
    requireChatAdmin({ ownerOnly: true }),
    async (req: Request, res: Response) => {
      const chatId = Number(req.params.chatId);
      const topicId = Number(req.params.topicId);
      if (!Number.isFinite(topicId)) {
        res.status(400).json({ error: "invalid_topic_id" });
        return;
      }
      const body = req.body as TopicBody;

      const existing = await topicRepository.findByChatAndTopic(chatId, topicId);
      if (!existing) {
        res.status(404).json({ error: "topic_not_found" });
        return;
      }

      const name = body.name !== undefined ? body.name.toString().trim() : existing.name;
      if (!name) {
        res.status(400).json({ error: "invalid_name" });
        return;
      }

      let allowedMsgTypes: string[] = existing.allowedMsgTypes;
      if (body.allowedMsgTypes !== undefined) {
        const sanitized = sanitizeTypes(body.allowedMsgTypes);
        if (sanitized === null) {
          res.status(400).json({ error: "invalid_allowed_types" });
          return;
        }
        allowedMsgTypes = sanitized;
      }

      const adminOnly =
        typeof body.adminOnly === "boolean" ? body.adminOnly : existing.adminOnly ?? false;

      try {
        const updated = await topicRepository.upsert({
          chatId,
          topicId,
          name,
          allowedMsgTypes,
          adminOnly,
        });
        logger.info({
          action: "topics.update",
          chatId,
          topicId,
          userId: req.user!.userId,
        });
        recordActivity({
          chatId,
          type: "topic_rule_change",
          source: "panel",
          actor: { id: req.user!.userId, name: req.user!.name, username: req.user!.username },
          targetRef: updated.name?.trim() || `Tema #${updated.topicId}`,
          topicId: updated.topicId,
          reason: `tipos: ${allowedMsgTypes.join(", ") || "ninguno"}${adminOnly ? " · solo admins" : ""}`,
        });
        res.json({
          chatId: updated.chatId,
          topicId: updated.topicId,
          name: updated.name,
          allowedMsgTypes: updated.allowedMsgTypes,
          adminOnly: updated.adminOnly ?? false,
          isUserConfigured: updated.isUserConfigured ?? true,
        });
      } catch (err) {
        logger.error({ action: "topics.update", error: String(err), chatId, topicId });
        res.status(500).json({ error: "internal_error" });
      }
    }
  );

  router.delete(
    "/:topicId",
    requireChatAdmin({ ownerOnly: true }),
    async (req: Request, res: Response) => {
      const chatId = Number(req.params.chatId);
      const topicId = Number(req.params.topicId);
      if (!Number.isFinite(topicId)) {
        res.status(400).json({ error: "invalid_topic_id" });
        return;
      }
      try {
        await topicRepository.deleteOne(chatId, topicId);
        logger.info({
          action: "topics.delete",
          chatId,
          topicId,
          userId: req.user!.userId,
        });
        recordActivity({
          chatId,
          type: "topic_rule_change",
          source: "panel",
          actor: { id: req.user!.userId, name: req.user!.name, username: req.user!.username },
          targetRef: `Tema #${topicId}`,
          topicId,
          reason: "regla eliminada",
        });
        res.status(204).end();
      } catch (err) {
        logger.error({ action: "topics.delete", error: String(err), chatId, topicId });
        res.status(500).json({ error: "internal_error" });
      }
    }
  );

  return router;
}
