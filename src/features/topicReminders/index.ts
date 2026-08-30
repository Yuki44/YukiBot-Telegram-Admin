import { Api, Middleware } from "grammy";
import { BotContext, IChat } from "../../types";
import { topicRepository } from "../../db/repositories/topicRepository";
import { sendTopicReminder } from "../../bot/helpers/sendTopicReminder";
import {
  TOPIC_REMINDER_INTERVAL_MS,
  TOPIC_REMINDER_DEBOUNCE_MS,
  TOPIC_REMINDER_MAX_WAIT_MS,
} from "../../config/constants";
import { logger } from "../../utils/logger";

// Per-topic rules reminder, debounced until the topic falls quiet so it lands after
// the sender's burst instead of shadowing their message or wedging between follow-ups.

interface PendingReminder {
  timer: ReturnType<typeof setTimeout>;
  firstArmedAt: number;
}

const pending = new Map<string, PendingReminder>();
const key = (chatId: number, topicId: number): string => `${chatId}:${topicId}`;

// Every DB write happens here at fire time, not at arm time, so a restart before
// firing just skips the cycle; the atomic claim makes a stale fire a no-op.
export async function flushTopicReminder(
  api: Api,
  chatConfig: IChat,
  chatId: number,
  topicId: number
): Promise<void> {
  try {
    const cutoff = new Date(Date.now() - TOPIC_REMINDER_INTERVAL_MS);
    const claimed = await topicRepository.claimReminderSend(chatId, topicId, cutoff);
    if (!claimed) return;

    const text = claimed.reminder?.text ?? "";
    const previousSentAt = claimed.reminder?.lastSentAt ?? null;
    if (text.trim().length === 0) {
      await topicRepository.releaseReminderClaim(chatId, topicId, previousSentAt);
      return;
    }

    const messageId = await sendTopicReminder(
      api,
      chatId,
      topicId,
      text,
      chatConfig.topicReminder?.button,
      claimed.reminder?.lastMessageId
    );

    if (messageId === null) {
      await topicRepository.releaseReminderClaim(chatId, topicId, previousSentAt);
    } else {
      await topicRepository.recordReminderSent(chatId, topicId, messageId);
    }
  } catch (error) {
    logger.error({ action: "topicReminderFlush", chatId, topicId, error: String(error) });
  }
}

// Each message resets the quiet window; the max-wait cap fires it anyway under
// continuous chatter so a busy topic still gets its reminder.
export function scheduleTopicReminder(api: Api, chatConfig: IChat, chatId: number, topicId: number): void {
  const k = key(chatId, topicId);
  const existing = pending.get(k);
  const firstArmedAt = existing?.firstArmedAt ?? Date.now();
  if (existing) clearTimeout(existing.timer);

  const fire = (): void => {
    pending.delete(k);
    void flushTopicReminder(api, chatConfig, chatId, topicId);
  };

  if (Date.now() - firstArmedAt >= TOPIC_REMINDER_MAX_WAIT_MS) {
    fire();
    return;
  }

  const timer = setTimeout(fire, TOPIC_REMINDER_DEBOUNCE_MS);
  (timer as { unref?: () => void }).unref?.(); // don't keep the process alive on shutdown
  pending.set(k, { timer, firstArmedAt });
}

/** Test-only: drop every armed timer so state can't leak between cases. */
export function resetTopicReminderState(): void {
  for (const { timer } of pending.values()) clearTimeout(timer);
  pending.clear();
}

export const topicReminders: Middleware<BotContext> = async (ctx, next) => {
  try {
    if (!ctx.chatConfig?.features.topicReminders) return await next();

    const chatId = ctx.chat?.id;
    const topicId = ctx.message?.message_thread_id; // absent = General, no Topic doc
    if (!chatId || !topicId) return await next();

    scheduleTopicReminder(ctx.api, ctx.chatConfig, chatId, topicId);
  } catch (error) {
    logger.error({ action: "topicReminders", error: String(error) });
  }
  return await next();
};
