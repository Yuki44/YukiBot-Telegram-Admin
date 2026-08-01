import { Api } from "grammy";
import { IChat } from "../../types";
import { esc } from "./html";
import { logger } from "../../utils/logger";

export type TopicReminderButton = NonNullable<IChat["topicReminder"]>["button"];

/**
 * Post a topic's rules reminder, replacing the previous one. The delete is
 * best-effort: a stale id must not silence the topic forever. Returns the new
 * message id, or null so the caller can release its claim and retry.
 */
export async function sendTopicReminder(
  api: Api,
  chatId: number,
  topicId: number,
  text: string,
  button: TopicReminderButton | undefined,
  previousMessageId?: number | null
): Promise<number | null> {
  if (previousMessageId) {
    try {
      await api.deleteMessage(chatId, previousMessageId);
    } catch (err) {
      logger.warn({
        action: "topicReminder_delete_previous",
        chatId,
        topicId,
        messageId: previousMessageId,
        error: String(err),
      });
    }
  }

  try {
    const reply_markup =
      button?.enabled && button.text.trim().length > 0 && button.url.trim().length > 0
        ? { inline_keyboard: [[{ text: button.text, url: button.url }]] }
        : undefined;

    const sent = await api.sendMessage(chatId, esc(text), {
      parse_mode: "HTML",
      message_thread_id: topicId,
      reply_markup,
    });
    return sent.message_id;
  } catch (err) {
    logger.error({ action: "sendTopicReminder", chatId, topicId, error: String(err) });
    return null;
  }
}
