import { createHash } from "crypto";
import { InlineKeyboard, NextFunction } from "grammy";
import { BotContext } from "../../types";
import { adminRepository } from "../../db/repositories/adminRepository";
import { spamPatternRepository, normalizeText } from "../../db/repositories/spamPatternRepository";
import { applyWarn } from "../../bot/helpers/applyWarn";
import { silenceUser } from "../../bot/helpers/silenceUser";
import { sendLog } from "../../bot/helpers/sendLog";
import { forwardToLog } from "../../bot/helpers/forwardToLog";
import { getChatTitle } from "../../bot/helpers/contextHelpers";
import { esc, mentionHtml } from "../../bot/helpers/html";
import { logger } from "../../utils/logger";
import { SILENCE_DURATION_S } from "../../config/constants";
import { t } from "../../locales/i18n";
import { IChat } from "../../types";
import { analyzeLinks } from "./linkAnalyzer";
import { matchesSpamPattern } from "./patternMatcher";
import { fullName } from "../../bot/helpers/fullName";

// ── Callback data helpers ────────────────────────────────────────────

/** spam_ok: "spam_ok:chatId:userId" */
export function buildCallbackData(verdict: "ok", chatId: number, userId: number): string {
  return `spam_${verdict}:${chatId}:${userId}`;
}

/** spam_rv: "spam_rv:chatId:userId:warnMsgId" */
export function buildRevertCallbackData(chatId: number, userId: number, warnMsgId: number): string {
  return `spam_rv:${chatId}:${userId}:${warnMsgId}`;
}

/** spam_apply: "spam_apply:chatId:userId:messageId:topicId" (topicId 0 = none) */
export function buildApplyCallbackData(
  chatId: number,
  userId: number,
  messageId: number,
  topicId?: number
): string {
  return `spam_apply:${chatId}:${userId}:${messageId}:${topicId ?? 0}`;
}

export function parseCallbackData(data: string): {
  verdict: "ok" | "rv" | "apply";
  chatId: number;
  userId: number;
  warnMsgId?: number;
  messageId?: number;
  topicId?: number;
} | null {
  const mok = data.match(/^spam_ok:(-?\d+):(\d+)$/);
  if (mok) {
    return { verdict: "ok", chatId: parseInt(mok[1], 10), userId: parseInt(mok[2], 10) };
  }
  const mrv = data.match(/^spam_rv:(-?\d+):(\d+):(\d+)$/);
  if (mrv) {
    return {
      verdict: "rv",
      chatId: parseInt(mrv[1], 10),
      userId: parseInt(mrv[2], 10),
      warnMsgId: parseInt(mrv[3], 10),
    };
  }
  const mapply = data.match(/^spam_apply:(-?\d+):(\d+):(\d+):(\d+)$/);
  if (mapply) {
    const topicId = parseInt(mapply[4], 10);
    return {
      verdict: "apply",
      chatId: parseInt(mapply[1], 10),
      userId: parseInt(mapply[2], 10),
      messageId: parseInt(mapply[3], 10),
      topicId: topicId > 0 ? topicId : undefined,
    };
  }
  return null;
}

/** Pings the chat's personal `notifyChatId` (if configured and enabled) about an auto/confirmed spam action. */
export async function notifySpamAdmin(
  ctx: BotContext,
  chatConfig: IChat | null | undefined,
  targetId: number,
  targetName: string,
  targetUsername: string | undefined
): Promise<void> {
  if (!chatConfig?.notifyFlags?.notifySpam || !chatConfig.notifyChatId) return;
  try {
    const who = mentionHtml(targetId, targetName, targetUsername);
    const chat = esc(chatConfig.name || getChatTitle(ctx));
    await ctx.api.sendMessage(chatConfig.notifyChatId, t("spam.adminNotify", { user: who, chat }), {
      parse_mode: "HTML",
    });
  } catch (err) {
    logger.error({ action: "notifySpamAdmin", chatId: chatConfig.chatId, error: String(err) });
  }
}

// ── Spam log sender ──────────────────────────────────────────────────

export async function sendSpamLog(
  ctx: BotContext,
  logsTo: number,
  chatId: number,
  chatName: string,
  chatType: "topics" | "normal",
  targetId: number,
  targetName: string,
  detectionReason: string,
  topicId: number | undefined,
  warnMsgId: number | undefined,
  options?: { unconfirmed?: boolean; messageId?: number }
): Promise<number | undefined> {
  try {
    const targetLink = `<a href="tg://user?id=${targetId}">${esc(targetName)}</a> [<code>${targetId}</code>]`;
    const grupo = `${esc(chatName)} [<code>${chatId}</code>]`;
    const cid = String(chatId).replace(/^-100/, "");

    const now = new Date();
    const meses = [
      "Enero",
      "Febrero",
      "Marzo",
      "Abril",
      "Mayo",
      "Junio",
      "Julio",
      "Agosto",
      "Septiembre",
      "Octubre",
      "Noviembre",
      "Diciembre",
    ];
    const fecha = `${now.getDate()} de ${meses[now.getMonth()]} ${now.getFullYear()} a las ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}:${String(now.getSeconds()).padStart(2, "0")}`;

    const header = options?.unconfirmed ? "⚠️ #POSIBLE_SPAM (sin confirmar)" : "🚫 #SPAM";
    const lines = [header, `• A: ${targetLink}`, `• Grupo: ${grupo}`];

    // Always add a navigable back-link — topic link if available, group link otherwise
    if (topicId) {
      lines.push(`• Tema: <a href="https://t.me/c/${cid}/${topicId}">⬅️ ir al tema</a>`);
    } else if (chatType === "topics") {
      lines.push(`• Grupo: <a href="https://t.me/c/${cid}/1">⬅️ ir al grupo</a>`);
    } else {
      lines.push(`• Grupo: <a href="https://t.me/c/${cid}/999999999">⬅️ ir al grupo</a>`);
    }

    lines.push(`• Razón: <code>${esc(detectionReason)}</code>`);
    lines.push(`• Fecha: ${fecha}`);
    lines.push(`#id${targetId}`);

    const text = lines.join("\n");

    const keyboard = options?.unconfirmed
      ? new InlineKeyboard().text(
          "🛡️ Aplicar sanción",
          buildApplyCallbackData(chatId, targetId, options.messageId ?? 0, topicId)
        )
      : new InlineKeyboard()
          .text("✅ Correcto", buildCallbackData("ok", chatId, targetId))
          .text(
            "↩️ Revertir (qsil + qav + borrar aviso)",
            buildRevertCallbackData(chatId, targetId, warnMsgId ?? 0)
          );

    const sent = await ctx.api.sendMessage(logsTo, text, {
      parse_mode: "HTML",
      reply_markup: keyboard,
    });

    return sent.message_id;
  } catch (err) {
    logger.error({ action: "sendSpamLog", chatId, error: String(err) });
    return undefined;
  }
}

// ── Main handler ─────────────────────────────────────────────────────

export async function promoSpamDetection(ctx: BotContext, next: NextFunction): Promise<void> {
  try {
    const chatConfig = ctx.chatConfig;
    if (!chatConfig) return await next();
    if (!chatConfig.features.promoSpamDetection) return await next();
    if (!chatConfig.logsTo) return await next();

    const msg = ctx.message;
    if (!msg) return await next();

    const sender = msg.from;
    if (!sender || sender.is_bot) return await next();

    // Admin bypass (G4)
    if (ctx.isAdmin) return await next();

    // Per-chat user whitelist
    const spamUserWhitelist: number[] = chatConfig.spamUserWhitelist ?? [];
    if (spamUserWhitelist.includes(sender.id)) return await next();

    // Double-check admin status in DB
    try {
      if (await adminRepository.isChatAdmin(sender.id, msg.chat.id)) return await next();
    } catch {
      /* continue */
    }

    const chatId = msg.chat.id;
    const topicId = msg.message_thread_id;
    const chatName = getChatTitle(ctx);
    const senderName = fullName(sender);
    const senderUsername = sender.username;
    const logsTo = chatConfig.logsTo;

    const forwardOrigin = msg.forward_origin as { type?: string } | undefined;
    const isForwardedFromChannel = forwardOrigin?.type === "channel" || forwardOrigin?.type === "chat";

    const entities = [...(msg.entities ?? []), ...(msg.caption_entities ?? [])];
    const linkWhitelist: string[] = chatConfig.linkWhitelist ?? [];

    // ── Load learned patterns from DB ────────────────────────────────
    let learnedPatternIds = new Set<string>();
    try {
      const patterns = await spamPatternRepository.findAll(chatId);
      learnedPatternIds = new Set(patterns.map((p) => p.patternId));
    } catch (err) {
      logger.error({ action: "promoSpamDetection_loadPatterns", chatId, error: String(err) });
    }

    // ── Run detectors ────────────────────────────────────────────────
    const spamText = msg.text ?? msg.caption ?? "";
    const normalized = normalizeText(spamText);
    const normalizedHash = createHash("sha256").update(normalized).digest("hex");

    const [linkResult, patternResult] = await Promise.all([
      Promise.resolve(
        analyzeLinks(
          entities,
          spamText,
          isForwardedFromChannel,
          linkWhitelist,
          chatId,
          (ctx.chat as { username?: string } | undefined)?.username
        )
      ),
      Promise.resolve(matchesSpamPattern(spamText, learnedPatternIds, normalizedHash)),
    ]);

    const flagged = linkResult.flagged || patternResult.matched;
    if (!flagged) return await next();

    const detectionReason = linkResult.flagged ? linkResult.reason : patternResult.tag;

    // Pattern matches are always trusted; a bare unconfirmed-TLD link match is not — a
    // missing-space typo (e.g. "listo.no") produces the exact same shape as a real link.
    const isLowConfidence = !patternResult.matched && linkResult.confidence === "low";

    if (isLowConfidence) {
      // Leave the message and user untouched — just surface it for manual review so a
      // typo never triggers an auto silence+warn (see linkAnalyzer.ts CONFIDENT_BARE_TLDS).
      await forwardToLog(ctx.api, logsTo, msg);
      await sendSpamLog(
        ctx,
        logsTo,
        chatId,
        chatName,
        chatConfig.type,
        sender.id,
        senderName,
        detectionReason,
        topicId,
        undefined,
        {
          unconfirmed: true,
          messageId: msg.message_id,
        }
      );
      logger.info({
        action: "promoSpamDetection_lowConfidence",
        userId: sender.id,
        chatId,
        reason: detectionReason,
      });
      return await next();
    }

    // ── Delete spam message immediately (file_ids remain valid after deletion) ─
    try {
      await ctx.api.deleteMessage(chatId, msg.message_id);
    } catch (err) {
      logger.error({ action: "promoSpamDetection_delete", chatId, error: String(err) });
    }

    // ── Send SPAM log (warnMsgId not yet known — keyboard updated after) ─────
    const spamLogMsgId = await sendSpamLog(
      ctx,
      logsTo,
      chatId,
      chatName,
      chatConfig.type,
      sender.id,
      senderName,
      detectionReason,
      topicId,
      undefined
    );

    // ── Capture spam message content to logs using the shared forwardToLog helper ─
    await forwardToLog(ctx.api, logsTo, msg);

    await silenceUser(ctx, sender.id, chatId);

    const muteUntil = new Date(Date.now() + SILENCE_DURATION_S * 1000);
    sendLog(ctx.api, chatConfig, {
      action: "SILENCIO",
      actor: { id: ctx.me.id, name: ctx.me.first_name, username: ctx.me.username },
      target: { id: sender.id, name: senderName, username: senderUsername },
      chatId,
      chatName,
      chatType: chatConfig.type,
      topicId,
      refMsgId: msg.message_id,
      muteUntil,
    }).catch(() => {});

    const { warnMsgId } = await applyWarn(ctx, sender.id, chatId, senderName, senderUsername, "por spam", {
      chatConfig,
      chatName,
      topicId,
      actor: { id: ctx.me.id, name: ctx.me.first_name, username: ctx.me.username },
    });

    await notifySpamAdmin(ctx, chatConfig, sender.id, senderName, senderUsername);

    // ── Update SPAM log keyboard with real warnMsgId ─────────────────
    if (spamLogMsgId && warnMsgId) {
      try {
        const updatedKeyboard = new InlineKeyboard()
          .text("✅ Correcto", buildCallbackData("ok", chatId, sender.id))
          .text(
            "↩️ Revertir (qsil + qav + borrar aviso)",
            buildRevertCallbackData(chatId, sender.id, warnMsgId)
          );
        await ctx.api.editMessageReplyMarkup(logsTo, spamLogMsgId, { reply_markup: updatedKeyboard });
      } catch {
        /* silent */
      }
    }

    logger.info({
      action: "promoSpamDetection_fired",
      userId: sender.id,
      chatId,
      reason: detectionReason,
    });
  } catch (err) {
    logger.error({ action: "promoSpamDetection", error: String(err) });
  }
}
