import { NextFunction } from "grammy";
import { BotContext } from "../../types";
import { adminRepository } from "../../db/repositories/adminRepository";
import { csamRecentMessageRepository } from "../../db/repositories/csamRecentMessageRepository";
import { enqueueUrgentBioCheck } from "../../features/csamDetection/scanner";

/**
 * On every message in a csamDetection OR languageDetection chat: queue a priority bio
 * check (csamDetection only) and log the message id for on-ban / language bulk-delete
 * cleanup (either feature — see plan_language_feature.md §3, a deliberate reuse of this
 * tracker rather than a duplicate one).
 */
export async function csamBioTrigger(ctx: BotContext, next: NextFunction): Promise<void> {
  try {
    const chatConfig = ctx.chatConfig;
    const csamOn = chatConfig?.features?.csamDetection;
    const languageOn = chatConfig?.features?.languageDetection;
    if (!csamOn && !languageOn) return await next();

    const msg = ctx.message;
    if (!msg) return await next();

    const sender = msg.from;
    if (!sender || sender.is_bot) return await next();

    if (ctx.isAdmin) return await next(); // G4 — never touch admin content
    if ((chatConfig?.spamUserWhitelist ?? []).includes(sender.id)) return await next();
    try {
      if (await adminRepository.isChatAdmin(sender.id, msg.chat.id)) return await next();
    } catch {
      /* continue */
    }

    if (csamOn) enqueueUrgentBioCheck(sender.id, msg.chat.id);
    const hasMedia = Boolean(
      msg.photo ||
        msg.video ||
        msg.animation ||
        msg.document ||
        msg.sticker ||
        msg.video_note ||
        msg.voice ||
        msg.audio
    );
    void csamRecentMessageRepository.record(sender.id, msg.chat.id, msg.message_id, hasMedia);
    return await next();
  } catch {
    return await next();
  }
}
