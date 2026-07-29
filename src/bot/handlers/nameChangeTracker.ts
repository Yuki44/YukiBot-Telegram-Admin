import { NextFunction } from "grammy";
import { BotContext } from "../../types";
import { trackIdentity } from "../../features/nameTracking";
import { fullName } from "../helpers/fullName";
import { logger } from "../../utils/logger";

/** On every message in a trackNameChanges chat: detect name/@username changes, announce, refresh the DB. */
export async function nameChangeTracker(ctx: BotContext, next: NextFunction): Promise<void> {
  try {
    const chatConfig = ctx.chatConfig;
    if (!chatConfig?.features?.trackNameChanges) return await next();

    const msg = ctx.message;
    const from = msg?.from;
    if (!msg || !from || from.is_bot) return await next();

    const current = {
      name: fullName(from),
      username: from.username,
    };
    await trackIdentity(ctx.api, chatConfig, from.id, msg.chat.id, current);
  } catch (err) {
    logger.error({ action: "nameChangeTracker", error: String(err) });
  }
  return await next();
}
