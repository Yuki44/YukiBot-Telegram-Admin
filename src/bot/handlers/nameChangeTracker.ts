import { NextFunction } from "grammy";
import { BotContext } from "../../types";
import { trackIdentity, trackIdentityEverywhere } from "../../features/nameTracking";
import { fullName } from "../helpers/fullName";
import { logger } from "../../utils/logger";

type SourceUser = {
  id: number;
  is_bot?: boolean;
  first_name?: string;
  last_name?: string;
  username?: string;
};

export async function trackIdentityFromTelegramUser(
  ctx: BotContext,
  from: SourceUser | undefined,
  chatId: number,
  source: "message" | "edited_message" | "chat_member" | "callback_query" = "message"
): Promise<void> {
  const chatConfig = ctx.chatConfig;
  if (!chatConfig || !from || from.is_bot) return;
  const current = { name: fullName(from), username: from.username };
  const changed = await trackIdentity(ctx.api, chatConfig, from.id, chatId, current, source);
  if (changed) await trackIdentityEverywhere(ctx.api, from.id, current, chatId, "fanout");
}

/**
 * On every message: refresh the stored identity and, in a trackNameChanges chat, announce the
 * change. Persisting here (not in trackUser) is what makes the comparison reliable — the
 * membership middleware used to overwrite the stored name before this handler could read it,
 * silently eating one change per user after every restart.
 *
 * A change seen here is fanned out to the user's other chats: names are global, and waiting for
 * the user to post in each chat left the rest months stale.
 */
export async function nameChangeTracker(ctx: BotContext, next: NextFunction): Promise<void> {
  try {
    const msg = ctx.message;
    const from = msg?.from;
    if (!msg || !from || from.is_bot || msg.chat.type === "private") return await next();
    await trackIdentityFromTelegramUser(ctx, from, msg.chat.id, "message");
  } catch (err) {
    logger.error({ action: "nameChangeTracker", error: String(err) });
  }
  return await next();
}
