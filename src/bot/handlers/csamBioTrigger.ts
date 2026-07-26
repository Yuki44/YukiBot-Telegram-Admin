import { NextFunction } from "grammy";
import { BotContext } from "../../types";
import { adminRepository } from "../../db/repositories/adminRepository";
import { enqueueUrgentBioCheck } from "../../features/csamDetection/scanner";

/** On every message in a csamDetection-enabled chat, queue the sender for a priority bio check. */
export async function csamBioTrigger(ctx: BotContext, next: NextFunction): Promise<void> {
  try {
    const chatConfig = ctx.chatConfig;
    if (!chatConfig?.features?.csamDetection) return await next();

    const msg = ctx.message;
    if (!msg) return await next();

    const sender = msg.from;
    if (!sender || sender.is_bot) return await next();

    if (ctx.isAdmin) return await next(); // G4 — never touch admin content
    if ((chatConfig.spamUserWhitelist ?? []).includes(sender.id)) return await next();
    try {
      if (await adminRepository.isChatAdmin(sender.id, msg.chat.id)) return await next();
    } catch {
      /* continue */
    }

    enqueueUrgentBioCheck(sender.id, msg.chat.id);
    return await next();
  } catch {
    return await next();
  }
}
