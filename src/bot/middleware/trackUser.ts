import { Middleware } from "grammy";
import { BotContext } from "../../types";
import { userRepository } from "../../db/repositories/userRepository";
import { trackLastMessage } from "../helpers/lastMessageTracker";
import { fullName } from "../helpers/fullName";
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
        .findOrCreate(from.id, chatId, from.username, fullName(from))
        .catch((err) => logger.error({ action: "trackUser", userId: from.id, error: String(err) }));
      // Propagate name/username to every other chat that knows this user so the
      // dashboard stays consistent without an explicit /refresh. Fire-and-forget.
      void userRepository.syncIdentityAcrossChats(from.id, {
        name: fullName(from),
        username: from.username ?? null,
      });
    }
  }

  await next();
};
