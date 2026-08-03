import { NextFunction } from "grammy";
import { BotContext } from "../../types";
import { trackIdentity, trackIdentityEverywhere } from "../../features/nameTracking";
import { fullName } from "../helpers/fullName";
import { logger } from "../../utils/logger";

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
    const chatConfig = ctx.chatConfig;
    if (!chatConfig) return await next();

    const msg = ctx.message;
    const from = msg?.from;
    if (!msg || !from || from.is_bot || msg.chat.type === "private") return await next();

    const current = {
      name: fullName(from),
      username: from.username,
    };
    const changed = await trackIdentity(ctx.api, chatConfig, from.id, msg.chat.id, current);
    // Only a real change is worth the cross-chat lookups; the steady state stays two queries.
    if (changed) await trackIdentityEverywhere(ctx.api, from.id, current, msg.chat.id, "fanout");
  } catch (err) {
    logger.error({ action: "nameChangeTracker", error: String(err) });
  }
  return await next();
}
