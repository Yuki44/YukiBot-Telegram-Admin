import { NextFunction } from "grammy";
import { BotContext } from "../../types";
import { adminRepository } from "../../db/repositories/adminRepository";
import { applyWarn } from "../../bot/helpers/applyWarn";
import { silenceUser } from "../../bot/helpers/silenceUser";
import { sendLog } from "../../bot/helpers/sendLog";
import { getChatTitle } from "../../bot/helpers/contextHelpers";
import { recordActivity } from "../../utils/activityLog";
import { resolveActions } from "../../utils/bannedWord";
import { logger } from "../../utils/logger";
import { SILENCE_DURATION_S } from "../../config/constants";
import { getActiveRules } from "./cache";
import { findMatchingRule } from "./matcher";

/**
 * Scan each incoming message against the chat's BannedWord rules and dispatch the
 * matched rule's severity. Skips admins (G4) and users on `spamUserWhitelist`.
 * Gated behind `features.bannedWordsEnforcement` (G8 — defaults to false).
 */
export async function bannedWordsEnforcement(ctx: BotContext, next: NextFunction): Promise<void> {
  try {
    const chatConfig = ctx.chatConfig;
    if (!chatConfig) return await next();
    if (!chatConfig.features.bannedWordsEnforcement) return await next();

    if (ctx.isAdmin) return await next();

    const msg = ctx.message;
    if (!msg) return await next();

    const sender = msg.from;
    if (!sender || sender.is_bot) return await next();

    const text = msg.text ?? msg.caption ?? "";
    if (!text) return await next();

    const chatId = msg.chat.id;
    const threadId = msg.message_thread_id;

    // Re-check admin status against the DB — same belt-and-braces pattern as promoSpamDetection
    try {
      if (await adminRepository.isChatAdmin(sender.id, chatId)) return await next();
    } catch {
      /* continue */
    }

    const spamUserWhitelist: number[] = chatConfig.spamUserWhitelist ?? [];
    if (spamUserWhitelist.includes(sender.id)) return await next();

    // Wrap the DB read so a transient failure doesn't kill the chain — downstream
    // spam detection still gets a shot at the message.
    let rules: Awaited<ReturnType<typeof getActiveRules>>;
    try {
      rules = await getActiveRules(chatId);
    } catch (err) {
      logger.error({ action: "bannedWordsEnforcement_getActiveRules", chatId, error: String(err) });
      return await next();
    }
    if (rules.length === 0) return await next();

    const rule = findMatchingRule(rules, text, threadId);
    if (!rule) return await next();

    const senderName = [sender.first_name, sender.last_name].filter(Boolean).join(" ") || "Usuario";
    const senderUsername = sender.username;
    const chatName = getChatTitle(ctx);
    const botActor = { id: ctx.me.id, name: ctx.me.first_name, username: ctx.me.username };
    const target = { id: sender.id, name: senderName, username: senderUsername };
    const ruleActions = resolveActions(rule);
    const reason = ruleActions.warnReason?.trim()
      ? ruleActions.warnReason.trim()
      : `palabra prohibida: ${rule.word}`;

    logger.info({
      action: "bannedWordsEnforcement_match",
      chatId,
      userId: sender.id,
      word: rule.word,
      actions: ruleActions,
      scope: rule.scope,
      topicId: rule.topicId,
    });

    // Dedicated channel log for every banned-word hit (independent of which
    // enforcement action runs — covers delete-only too). Gated by the chat's
    // logBannedWords flag inside sendLog, like every other log type.
    sendLog(ctx.api, chatConfig, {
      action: "PALABRA_PROHIBIDA",
      target,
      chatId,
      chatName,
      chatType: chatConfig.type,
      topicId: threadId,
      word: rule.word,
    }).catch(() => {});

    // Independent admin notification — runs alongside any enforcement.
    if (ruleActions.flag && chatConfig.logsTo) {
      try {
        await ctx.api.sendMessage(
          chatConfig.logsTo,
          `🚩 <b>Palabra marcada</b>\n• Usuario: <a href="tg://user?id=${sender.id}">${senderName}</a> [<code>${sender.id}</code>]\n• Palabra: <code>${rule.word}</code>\n• Mensaje: <i>${text.slice(0, 200)}</i>`,
          { parse_mode: "HTML" }
        );
      } catch {
        /* silent (G10) */
      }
    }

    // Kick supersedes everything else.
    if (ruleActions.kick) {
      try {
        await ctx.deleteMessage();
      } catch {
        /* silent */
      }
      let kicked = false;
      try {
        await ctx.api.banChatMember(chatId, sender.id);
        await ctx.api.unbanChatMember(chatId, sender.id);
        kicked = true;
      } catch (err) {
        logger.error({
          action: "bannedWordsEnforcement_kick",
          chatId,
          userId: sender.id,
          error: String(err),
        });
      }
      if (kicked) {
        sendLog(ctx.api, chatConfig, {
          action: "KICK",
          actor: botActor,
          target,
          chatId,
          chatName,
          chatType: chatConfig.type,
          topicId: threadId,
          reason,
          repliedMsg: msg,
        }).catch(() => {});
        recordActivity({
          chatId,
          type: "kick",
          source: "bot",
          actor: botActor,
          target,
          reason,
          topicId: threadId,
          messageText: text,
        });
      }
      return;
    }

    // Multi-action combo: apply each enabled action in a stable order.
    if (ruleActions.delete || ruleActions.silence) {
      try {
        await ctx.deleteMessage();
      } catch {
        /* silent (G10) */
      }
    }

    if (ruleActions.warn) {
      await applyWarn(ctx, sender.id, chatId, senderName, senderUsername, reason, {
        chatConfig,
        chatName,
        topicId: threadId,
        actor: botActor,
        repliedMsg: msg,
      });
    }

    if (ruleActions.silence) {
      const ok = await silenceUser(ctx, sender.id, chatId);
      if (ok) {
        const muteUntil = new Date(Date.now() + SILENCE_DURATION_S * 1000);
        // AVISO above already forwards the original (when warn fires); skip here to avoid duplicate Mensaje original
        sendLog(ctx.api, chatConfig, {
          action: "SILENCIO",
          actor: botActor,
          target,
          chatId,
          chatName,
          chatType: chatConfig.type,
          topicId: threadId,
          muteUntil,
          reason,
          repliedMsg: ruleActions.warn ? undefined : msg,
        }).catch(() => {});
        recordActivity({
          chatId,
          type: "silence",
          source: "bot",
          actor: botActor,
          target,
          reason,
          topicId: threadId,
          messageText: text,
        });
      }
    }
  } catch (err) {
    logger.error({ action: "bannedWordsEnforcement", error: String(err) });
  }
}
