import { Middleware } from "grammy";
import { BotContext } from "../../types";
import { topicRepository } from "../../db/repositories/topicRepository";
import { logger } from "../../utils/logger";

// Session-level dedup: one DB write per (chatId, topicId) per bot run.
const seen = new Set<string>();

/**
 * Passive topic discovery. Telegram's bot API exposes no "list topics" endpoint, so
 * the only way to surface a forum topic in the dashboard (e.g. the banned-words
 * topic-scope dropdown) is to record one whenever we see a message inside it.
 *
 * Cheap: dedup keeps it to a single DB write per topic per bot run, and the
 * repository's recordSeen uses $setOnInsert so real names from forum_topic_created
 * are never clobbered.
 */
export const trackTopic: Middleware<BotContext> = async (ctx, next) => {
  const chatId = ctx.chat?.id;
  const topicId = ctx.message?.message_thread_id;

  if (chatId && topicId) {
    const key = `${chatId}:${topicId}`;
    if (!seen.has(key)) {
      seen.add(key);
      topicRepository
        .recordSeen(chatId, topicId)
        .catch((err) => logger.error({ action: "trackTopic", chatId, topicId, error: String(err) }));
    }
  }

  await next();
};
