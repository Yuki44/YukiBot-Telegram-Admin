import { Middleware } from "grammy";
import { BotContext } from "../../types";
import { topicRepository } from "../../db/repositories/topicRepository";
import { sendTopicReminder } from "../../bot/helpers/sendTopicReminder";
import { TOPIC_REMINDER_INTERVAL_MS } from "../../config/constants";
import { logger } from "../../utils/logger";

/**
 * Per-topic rules reminder: a message in a topic reposts that topic's reminder
 * when the last one is older than TOPIC_REMINDER_INTERVAL_MS. Activity-driven,
 * so a dead topic never gets one. Registered last in the message chain, so a
 * message an earlier filter deleted never triggers a reminder.
 */
export const topicReminders: Middleware<BotContext> = async (ctx, next) => {
  try {
    if (!ctx.chatConfig?.features.topicReminders) return await next();

    const chatId = ctx.chat?.id;
    const topicId = ctx.message?.message_thread_id;
    // No thread id = General, which has no Topic document.
    if (!chatId || !topicId) return await next();

    const cutoff = new Date(Date.now() - TOPIC_REMINDER_INTERVAL_MS);
    const claimed = await topicRepository.claimReminderSend(chatId, topicId, cutoff);
    if (!claimed) return await next();

    const text = claimed.reminder?.text ?? "";
    const previousSentAt = claimed.reminder?.lastSentAt ?? null;

    if (text.trim().length === 0) {
      // Give the claim back so adding real text isn't stuck behind an interval.
      await topicRepository.releaseReminderClaim(chatId, topicId, previousSentAt);
      return await next();
    }

    const messageId = await sendTopicReminder(
      ctx.api,
      chatId,
      topicId,
      text,
      ctx.chatConfig.topicReminder?.button,
      claimed.reminder?.lastMessageId
    );

    if (messageId === null) {
      await topicRepository.releaseReminderClaim(chatId, topicId, previousSentAt);
    } else {
      await topicRepository.recordReminderSent(chatId, topicId, messageId);
    }

    await next();
  } catch (error) {
    logger.error({ action: "topicReminders", error: String(error) });
    await next();
  }
};
