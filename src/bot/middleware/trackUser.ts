import { Middleware } from "grammy";
import { BotContext } from "../../types";
import { userRepository } from "../../db/repositories/userRepository";
import { trackLastMessage } from "../helpers/lastMessageTracker";
import { logger } from "../../utils/logger";

// Session-level dedup: one DB write per (userId, chatId) per bot run
const seen = new Set<string>();

export const trackUser: Middleware<BotContext> = async (ctx, next) => {
  const from = ctx.from;
  const chatId = ctx.chat?.id;

  if (from && !from.is_bot && chatId) {
    const messageId = ctx.message?.message_id;
    if (messageId) {
      trackLastMessage(from.id, chatId, messageId);
    }

    const key = `${from.id}:${chatId}`;
    if (!seen.has(key)) {
      seen.add(key);
      userRepository
        .findOrCreate(from.id, chatId, from.username, from.first_name)
        .catch((err) => logger.error({ action: "trackUser", userId: from.id, error: String(err) }));
    }
  }

  await next();
};
