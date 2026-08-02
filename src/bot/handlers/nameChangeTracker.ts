import { NextFunction } from "grammy";
import { BotContext } from "../../types";
import { trackIdentity } from "../../features/nameTracking";
import { fullName } from "../helpers/fullName";
import { logger } from "../../utils/logger";

/**
 * On every message: refresh the stored identity and, in a trackNameChanges chat, announce the
 * change. Persisting here (not in trackUser) is what makes the comparison reliable — the
 * membership middleware used to overwrite the stored name before this handler could read it,
 * silently eating one change per user after every restart.
 */
export async function nameChangeTracker(ctx: BotContext, next: NextFunction): Promise<void> {
  try {
    const chatConfig = ctx.chatConfig;
    if (!chatConfig) return await next();

    const msg = ctx.message;
    const from = msg?.from;
    if (!msg || !from || from.is_bot || msg.chat.type === "private") return await next();

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
