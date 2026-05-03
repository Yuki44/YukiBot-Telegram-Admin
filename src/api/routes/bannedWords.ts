import { Router, Request, Response } from "express";
import { authenticate } from "../middleware/authenticate";
import { requireChatAdmin } from "../middleware/requireChatAdmin";
import { bannedWordRepository } from "../../db/repositories/bannedWordRepository";
import { logger } from "../../utils/logger";
import { recordActivity } from "../../utils/activityLog";
import { BannedWordSeverity, IBannedWord } from "../../types";

const VALID_SEVERITIES: BannedWordSeverity[] = ["flag", "aviso", "borrar", "silenciar", "kick"];

interface CreateBody {
  word?: string;
  severity?: string;
  exactMatch?: boolean;
  scope?: string;
  topicId?: number;
}

function toDto(w: IBannedWord) {
  return {
    id: String(w._id),
    chatId: w.chatId,
    word: w.word,
    severity: w.severity,
    exactMatch: w.exactMatch,
    scope: w.scope,
    topicId: w.topicId ?? null,
    createdBy: w.createdBy,
    createdAt: w.createdAt.toISOString(),
  };
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

    if (!VALID_SEVERITIES.includes(body.severity as BannedWordSeverity)) {
      res.status(400).json({ error: "invalid_severity" });
      return;
    }
    const severity = body.severity as BannedWordSeverity;

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
        severity,
        exactMatch: !!body.exactMatch,
        scope,
        topicId,
        createdBy: req.user!.userId,
      });
      logger.info({
        action: "bannedWords.create",
        chatId,
        word,
        severity,
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
        reason: `${severity}${scope === "topic" ? ` · tema ${topicId}` : ""}`,
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
