import { InlineKeyboard } from "grammy";
import { Message } from "grammy/types";
import { BotContext } from "../../types";
import { userRepository } from "../../db/repositories/userRepository";
import { csamRecentMessageRepository } from "../../db/repositories/csamRecentMessageRepository";
import { deleteMessagesConfirmed } from "../csamDetection/actions";
import { applyWarn } from "../../bot/helpers/applyWarn";
import { buildNavLine } from "../../bot/helpers/sendLog";
import { forwardToLog } from "../../bot/helpers/forwardToLog";
import { mentionHtml, mentionFullHtml, esc } from "../../bot/helpers/html";
import { getChatTitle } from "../../bot/helpers/contextHelpers";
import { recordActivity } from "../../utils/activityLog";
import { logger } from "../../utils/logger";
import { t } from "../../locales/i18n";
import { LANGUAGE_BULK_DELETE_WINDOW_MS, MAX_WARNINGS } from "../../config/constants";

export interface LanguageTarget {
  userId: number;
  name: string;
  username?: string;
}

/** "langgrace_reset:chatId:userId" */
export function buildGraceCallback(chatId: number, userId: number): string {
  return `langgrace_reset:${chatId}:${userId}`;
}

export function parseGraceCallback(data: string): { chatId: number; userId: number } | null {
  const m = data.match(/^langgrace_reset:(-?\d+):(\d+)$/);
  if (!m) return null;
  return { chatId: parseInt(m[1], 10), userId: parseInt(m[2], 10) };
}

export function buildBotActor(ctx: BotContext): { id: number; name: string; username?: string } {
  return { id: ctx.me.id, name: ctx.me.first_name, username: ctx.me.username };
}

export function buildAdminNotifyText(
  target: LanguageTarget,
  warningsAfter: number,
  banned: boolean,
  chatName: string
): string {
  const who = mentionFullHtml(target.userId, target.name, target.username, { idFallback: true });
  const chat = esc(chatName);
  return banned
    ? t("language.adminNotifyBanned", { user: who, max: MAX_WARNINGS, chat })
    : t("language.adminNotifyWarn", { user: who, current: warningsAfter, max: MAX_WARNINGS, chat });
}

async function sendLanguageAdminNotify(ctx: BotContext, text: string): Promise<void> {
  const notifyChatId = ctx.chatConfig?.notifyChatId;
  if (!notifyChatId) return;
  try {
    await ctx.api.sendMessage(notifyChatId, text, { parse_mode: "HTML" });
  } catch (err) {
    logger.error({ action: "language_admin_notify", chatId: ctx.chatConfig?.chatId, error: String(err) });
  }
}

async function sendLanguageGraceLog(
  ctx: BotContext,
  target: LanguageTarget,
  message: Message
): Promise<void> {
  const chatConfig = ctx.chatConfig;
  if (!chatConfig?.logsTo) return;

  const who = mentionHtml(target.userId, target.name, target.username);
  const chatName = getChatTitle(ctx);
  const navLine = buildNavLine(
    message.chat.id,
    chatConfig.type,
    message.message_thread_id,
    message.message_id
  );
  const text = [
    "🌐 #IDIOMA",
    `• Usuario: ${who} [<code>${target.userId}</code>]`,
    `• Grupo: ${esc(chatName)} [<code>${message.chat.id}</code>]`,
    navLine,
    "• Primer aviso de idioma — sin sanción, mensaje borrado.",
    `#id${target.userId}`,
  ].join("\n");
  const keyboard = new InlineKeyboard().text(
    "➕ Otorgar gracia extra",
    buildGraceCallback(message.chat.id, target.userId)
  );

  try {
    await ctx.api.sendMessage(chatConfig.logsTo, text, { parse_mode: "HTML", reply_markup: keyboard });
    await forwardToLog(ctx.api, chatConfig.logsTo, message);
  } catch (err) {
    logger.error({
      action: "language_grace_log",
      chatId: message.chat.id,
      userId: target.userId,
      error: String(err),
    });
  }
}

/** Marks the language grace as consumed. Shared by the grace path and the direct-warn path. */
async function markGraceSpent(target: LanguageTarget, chatId: number): Promise<void> {
  try {
    await userRepository.upsert({
      userId: target.userId,
      chatId,
      username: target.username,
      name: target.name,
      languageGraceGivenAt: new Date(),
    });
  } catch (err) {
    logger.error({ action: "language_grace_persist", chatId, userId: target.userId, error: String(err) });
  }
}

/** First offense: delete + friendly notice (stays in chat) + remember + log with an undo button. */
export async function executeLanguageGrace(
  ctx: BotContext,
  target: LanguageTarget,
  message: Message
): Promise<void> {
  const chatId = message.chat.id;

  try {
    await ctx.api.deleteMessage(chatId, message.message_id);
  } catch (err) {
    logger.error({ action: "language_grace_delete", chatId, userId: target.userId, error: String(err) });
  }

  const who = mentionFullHtml(target.userId, target.name, target.username);
  try {
    await ctx.api.sendMessage(chatId, t("language.graceNotice", { user: who }), {
      parse_mode: "HTML",
      message_thread_id: message.message_thread_id,
    });
  } catch (err) {
    logger.error({ action: "language_grace_notice", chatId, userId: target.userId, error: String(err) });
  }

  await markGraceSpent(target, chatId);

  await sendLanguageGraceLog(ctx, target, message);
}

/** Second+ offense (or first with prior warnings): elav-equivalent (delete + warn) + bulk-delete + admin ping. */
export async function executeLanguageEnforcement(
  ctx: BotContext,
  target: LanguageTarget,
  message: Message
): Promise<void> {
  const chatId = message.chat.id;
  const actor = buildBotActor(ctx);

  try {
    await ctx.api.deleteMessage(chatId, message.message_id);
  } catch (err) {
    logger.error({ action: "language_enforce_delete", chatId, userId: target.userId, error: String(err) });
  }

  const { banned, warningsAfter } = await applyWarn(
    ctx,
    target.userId,
    chatId,
    target.name,
    target.username,
    t("language.warnReason"),
    { actor, repliedMsg: message }
  );

  try {
    const sinceMs = Date.now() - LANGUAGE_BULK_DELETE_WINDOW_MS;
    const ids = await csamRecentMessageRepository.findMessageIdsSince(target.userId, chatId, sinceMs);
    const res = await deleteMessagesConfirmed(ctx.api, chatId, ids);
    logger.info({
      action: "language_bulk_delete",
      chatId,
      userId: target.userId,
      found: ids.length,
      deleted: res.deleted.length,
      failed: res.failed.length,
    });
    if (res.deleted.length > 0) {
      recordActivity({
        chatId,
        type: "message_delete",
        source: "bot",
        actor,
        target: { id: target.userId, name: target.name, username: target.username },
        reason: `idioma — ${res.deleted.length} mensaje(s) borrado(s)`,
      });
    }
  } catch (err) {
    logger.error({ action: "language_bulk_delete_query", chatId, userId: target.userId, error: String(err) });
  }

  if (warningsAfter !== undefined) {
    const chatName = getChatTitle(ctx);
    await sendLanguageAdminNotify(
      ctx,
      buildAdminNotifyText(target, warningsAfter, banned ?? false, chatName)
    );
  }
}

export async function handleLanguageOffense(
  ctx: BotContext,
  target: LanguageTarget,
  message: Message
): Promise<void> {
  try {
    const user = await userRepository.findByUserAndChat(target.userId, message.chat.id);
    const graceSpent = Boolean(user?.languageGraceGivenAt);
    const hasWarnings = (user?.warnings ?? 0) > 0;

    if (!graceSpent && !hasWarnings) {
      await executeLanguageGrace(ctx, target, message);
    } else {
      if (!graceSpent) await markGraceSpent(target, message.chat.id);
      await executeLanguageEnforcement(ctx, target, message);
    }
  } catch (err) {
    logger.error({
      action: "language_offense_handle",
      chatId: message.chat.id,
      userId: target.userId,
      error: String(err),
    });
  }
}
