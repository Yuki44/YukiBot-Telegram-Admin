import { Router, Request, Response } from "express";
import { authenticate } from "../middleware/authenticate";
import { requireChatAdmin } from "../middleware/requireChatAdmin";
import { bannedWordRepository } from "../../db/repositories/bannedWordRepository";
import { invalidateBannedWordsCache } from "../../features/bannedWordsEnforcement/cache";
import { logger } from "../../utils/logger";
import { recordActivity } from "../../utils/activityLog";
import { IBannedWord } from "../../types";
import { resolveActions } from "../../utils/bannedWord";

interface CreateBody {
  word?: string;
  actions?: { delete?: boolean; warn?: boolean; silence?: boolean };
  kick?: boolean;
  flag?: boolean;
  warnReason?: string;
  exactMatch?: boolean;
  scope?: string;
  topicId?: number;
}

function toDto(w: IBannedWord) {
  const a = resolveActions(w);
  return {
    id: String(w._id),
    chatId: w.chatId,
    word: w.word,
    // Legacy severity kept for any older client that hasn't refreshed yet.
    severity: w.severity,
    actions: { delete: a.delete, warn: a.warn, silence: a.silence },
    kick: a.kick,
    flag: a.flag,
    warnReason: a.warnReason,
    exactMatch: w.exactMatch,
    scope: w.scope,
    topicId: w.topicId ?? null,
    createdBy: w.createdBy,
    createdAt: w.createdAt.toISOString(),
  };
}

function summarizeActions(a: { delete: boolean; warn: boolean; silence: boolean; kick: boolean; flag: boolean }): string {
  if (a.kick) return "expulsar";
  const parts: string[] = [];
  if (a.delete) parts.push("borrar");
  if (a.warn) parts.push("aviso");
  if (a.silence) parts.push("silenciar");
  if (a.flag) parts.push("avisar admins");
  return parts.join("+") || "flag";
}

export function createBannedWordsRouter(): Router {
  const router = Router({ mergeParams: true });

  router.use(authenticate);

  router.get("/", requireChatAdmin(), async (req: Request, res: Response) => {
    const chatId = Number(req.params.chatId);
    try {
      const words = await bannedWordRepository.findByChatId(chatId);
      res.json(words.map(toDto));
    } catch (err) {
      logger.error({ action: "bannedWords.list", error: String(err), chatId });
      res.status(500).json({ error: "internal_error" });
    }
  });

  router.post("/", requireChatAdmin(), async (req: Request, res: Response) => {
    const chatId = Number(req.params.chatId);
    const body = req.body as CreateBody;

    const word = (body.word ?? "").toString().trim();
    if (word.length < 1 || word.length > 200) {
      res.status(400).json({ error: "invalid_word" });
      return;
    }

    const actions = {
      delete: !!body.actions?.delete,
      warn: !!body.actions?.warn,
      silence: !!body.actions?.silence,
    };
    const kick = !!body.kick;
    const flag = !!body.flag;

    // At least one enforcement action must be picked. `flag` is intentionally NOT a valid
    // standalone choice yet — the UI greys it out as "Próximamente".
    const hasAction = actions.delete || actions.warn || actions.silence || kick;
    if (!hasAction) {
      res.status(400).json({ error: "no_action_selected" });
      return;
    }

    // Kick is exclusive with the action triplet — defend against frontend bugs that
    // send both.
    const sanitizedActions = kick ? { delete: false, warn: false, silence: false } : actions;

    const warnReason = body.warnReason?.toString().trim() || null;

    const scope = body.scope === "topic" ? "topic" : "all";
    let topicId: number | undefined;
    if (scope === "topic") {
      if (typeof body.topicId !== "number" || !Number.isFinite(body.topicId)) {
        res.status(400).json({ error: "invalid_topic_id" });
        return;
      }
      topicId = body.topicId;
    }

    try {
      const created = await bannedWordRepository.create({
        chatId,
        word,
        actions: sanitizedActions,
        kick,
        flag,
        warnReason,
        exactMatch: !!body.exactMatch,
        scope,
        topicId,
        createdBy: req.user!.userId,
      });
      invalidateBannedWordsCache(chatId);
      const summary = summarizeActions({ ...sanitizedActions, kick, flag });
      logger.info({
        action: "bannedWords.create",
        chatId,
        word,
        summary,
        scope,
        topicId,
        userId: req.user!.userId,
      });
      recordActivity({
        chatId,
        type: "banned_word_add",
        source: "panel",
        actor: { id: req.user!.userId, name: req.user!.name, username: req.user!.username },
        targetRef: word,
        reason: `${summary}${scope === "topic" ? ` · tema ${topicId}` : ""}`,
        topicId,
      });
      res.json(toDto(created));
    } catch (err) {
      const errStr = String(err);
      // Mongo duplicate-key error → 409
      if (errStr.includes("E11000")) {
        res.status(409).json({ error: "duplicate_word" });
        return;
      }
      logger.error({ action: "bannedWords.create", error: errStr, chatId, word });
      res.status(500).json({ error: "internal_error" });
    }
  });

  router.delete("/:id", requireChatAdmin(), async (req: Request, res: Response) => {
    const chatId = Number(req.params.chatId);
    const id = req.params.id;
    try {
      const ok = await bannedWordRepository.remove(id);
      if (!ok) {
        res.status(404).json({ error: "not_found" });
        return;
      }
      invalidateBannedWordsCache(chatId);
      logger.info({
        action: "bannedWords.delete",
        chatId,
        id,
        userId: req.user!.userId,
      });
      recordActivity({
        chatId,
        type: "banned_word_remove",
        source: "panel",
        actor: { id: req.user!.userId, name: req.user!.name, username: req.user!.username },
        targetRef: id,
      });
      res.status(204).end();
    } catch (err) {
      logger.error({ action: "bannedWords.delete", error: String(err), chatId, id });
      res.status(500).json({ error: "internal_error" });
    }
  });

  return router;
}
