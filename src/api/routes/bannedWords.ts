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

interface ParsedBody {
  word: string;
  actions: { delete: boolean; warn: boolean; silence: boolean };
  kick: boolean;
  flag: boolean;
  warnReason: string | null;
  exactMatch: boolean;
  scope: "all" | "topic";
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

function summarizeActions(a: {
  delete: boolean;
  warn: boolean;
  silence: boolean;
  kick: boolean;
  flag: boolean;
}): string {
  if (a.kick) return "expulsar";
  const parts: string[] = [];
  if (a.delete) parts.push("borrar");
  if (a.warn) parts.push("aviso");
  if (a.silence) parts.push("silenciar");
  if (a.flag) parts.push("avisar admins");
  return parts.join("+") || "flag";
}

/**
 * Validate and normalise the create/update payload. On any validation failure it
 * writes the error response and returns null. Shared by POST and PUT.
 *
 * `kick` is intentionally ignored — "Expulsar del grupo" was removed, so no new
 * rule can be created or edited into a kick rule (legacy kick rows still enforce
 * until an admin deletes them).
 */
function parseBody(req: Request, res: Response): ParsedBody | null {
  const body = req.body as CreateBody;

  const word = (body.word ?? "").toString().trim();
  if (word.length < 1 || word.length > 200) {
    res.status(400).json({ error: "invalid_word" });
    return null;
  }

  const exactMatch = !!body.exactMatch;
  // Flexible/disguise detection only makes sense for a single token.
  if (exactMatch && /\s/.test(word)) {
    res.status(400).json({ error: "fuzzy_needs_single_word" });
    return null;
  }

  const actions = {
    delete: !!body.actions?.delete,
    warn: !!body.actions?.warn,
    silence: !!body.actions?.silence,
  };
  const flag = !!body.flag;

  const hasAction = actions.delete || actions.warn || actions.silence;
  if (!hasAction) {
    res.status(400).json({ error: "no_action_selected" });
    return null;
  }

  const warnReason = body.warnReason?.toString().trim() || null;
  // A warning with no reason is useless to the user — require one.
  if (actions.warn && !warnReason) {
    res.status(400).json({ error: "warn_reason_required" });
    return null;
  }

  const scope = body.scope === "topic" ? "topic" : "all";
  let topicId: number | undefined;
  if (scope === "topic") {
    if (typeof body.topicId !== "number" || !Number.isFinite(body.topicId)) {
      res.status(400).json({ error: "invalid_topic_id" });
      return null;
    }
    topicId = body.topicId;
  }

  return { word, actions, kick: false, flag, warnReason, exactMatch, scope, topicId };
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
    const parsed = parseBody(req, res);
    if (!parsed) return;

    try {
      const created = await bannedWordRepository.create({
        chatId,
        word: parsed.word,
        actions: parsed.actions,
        kick: parsed.kick,
        flag: parsed.flag,
        warnReason: parsed.warnReason,
        exactMatch: parsed.exactMatch,
        scope: parsed.scope,
        topicId: parsed.topicId,
        createdBy: req.user!.userId,
      });
      invalidateBannedWordsCache(chatId);
      const summary = summarizeActions({ ...parsed.actions, kick: parsed.kick, flag: parsed.flag });
      logger.info({
        action: "bannedWords.create",
        chatId,
        word: parsed.word,
        summary,
        scope: parsed.scope,
        topicId: parsed.topicId,
        userId: req.user!.userId,
      });
      recordActivity({
        chatId,
        type: "banned_word_add",
        source: "panel",
        actor: { id: req.user!.userId, name: req.user!.name, username: req.user!.username },
        targetRef: parsed.word,
        reason: `${summary}${parsed.scope === "topic" ? ` · tema ${parsed.topicId}` : ""}`,
        topicId: parsed.topicId,
      });
      res.json(toDto(created));
    } catch (err) {
      const errStr = String(err);
      // Mongo duplicate-key error → 409
      if (errStr.includes("E11000")) {
        res.status(409).json({ error: "duplicate_word" });
        return;
      }
      logger.error({ action: "bannedWords.create", error: errStr, chatId, word: parsed.word });
      res.status(500).json({ error: "internal_error" });
    }
  });

  // Editing an existing rule is restricted to the chat owner / delegated owner /
  // super-admin (requireChatAdmin handles all three via ownerOnly).
  router.put("/:id", requireChatAdmin({ ownerOnly: true }), async (req: Request, res: Response) => {
    const chatId = Number(req.params.chatId);
    const id = req.params.id;
    const parsed = parseBody(req, res);
    if (!parsed) return;

    try {
      const updated = await bannedWordRepository.update(id, {
        word: parsed.word,
        actions: parsed.actions,
        kick: parsed.kick,
        flag: parsed.flag,
        warnReason: parsed.warnReason,
        exactMatch: parsed.exactMatch,
        scope: parsed.scope,
        topicId: parsed.topicId,
      });
      if (!updated) {
        res.status(404).json({ error: "not_found" });
        return;
      }
      invalidateBannedWordsCache(chatId);
      logger.info({
        action: "bannedWords.update",
        chatId,
        id,
        word: parsed.word,
        summary: summarizeActions({ ...parsed.actions, kick: parsed.kick, flag: parsed.flag }),
        scope: parsed.scope,
        topicId: parsed.topicId,
        userId: req.user!.userId,
      });
      res.json(toDto(updated));
    } catch (err) {
      const errStr = String(err);
      if (errStr.includes("E11000")) {
        res.status(409).json({ error: "duplicate_word" });
        return;
      }
      logger.error({ action: "bannedWords.update", error: errStr, chatId, id });
      res.status(500).json({ error: "internal_error" });
    }
  });

  // Deleting a rule is owner / super-admin only (same gate as edit).
  router.delete("/:id", requireChatAdmin({ ownerOnly: true }), async (req: Request, res: Response) => {
    const chatId = Number(req.params.chatId);
    const id = req.params.id;
    try {
      const existing = await bannedWordRepository.findById(id);
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
        targetRef: existing?.word ?? id,
      });
      res.status(204).end();
    } catch (err) {
      logger.error({ action: "bannedWords.delete", error: String(err), chatId, id });
      res.status(500).json({ error: "internal_error" });
    }
  });

  return router;
}
