import { Middleware } from "grammy";
import { BotContext } from "../../types";
import { userRepository } from "../../db/repositories/userRepository";

// Session-level dedup: one DB write per (userId, chatId) per bot run
const seen = new Set<string>();

export const trackUser: Middleware<BotContext> = async (ctx, next) => {
  const from = ctx.from;
  const chatId = ctx.chat?.id;

  if (from && !from.is_bot && chatId) {
    const key = `${from.id}:${chatId}`;
    if (!seen.has(key)) {
      seen.add(key);
      console.log(`[trackUser] Updating DB for user ${from.id} (${from.username || 'no username'}) in chat ${chatId}`);
      userRepository
        .findOrCreate(from.id, chatId, from.username, from.first_name)
        .catch((err) => console.error(`[trackUser] Error updating user ${from.id}:`, err));
    }
  }

  await next();
};
