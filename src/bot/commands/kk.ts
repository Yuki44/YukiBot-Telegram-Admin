import { BotContext } from "../../types";
import { resolveTarget } from "../helpers/resolveTarget";
import { adminRepository } from "../../db/repositories/adminRepository";
import { sendAndAutoDelete } from "../helpers/sendAndAutoDelete";
import { sendLog } from "../helpers/sendLog";
import { markKickInProgress } from "../helpers/kickTracker";
import { mention } from "../helpers/html";
import { parseArgs, buildActor, getChatTitle } from "../helpers/contextHelpers";
import { logger } from "../../utils/logger";
import { t } from "../../locales/i18n";

export async function kkHandler(ctx: BotContext): Promise<void> {
  if (!ctx.chatConfig) return;

  try {
    const chatId = ctx.chat!.id;
    const args = parseArgs(ctx);

    const target = await resolveTarget(ctx, args);
    if (!target) {
      const msg =
        args.length > 0 || ctx.message?.reply_to_message ? t("errors.userNotFound") : t("errors.specifyUser");
      await sendAndAutoDelete(ctx, msg, 0);
      try {
        await ctx.deleteMessage();
      } catch {
        /* ignore */
      }
      return;
    }

    const isTargetAdmin = await adminRepository.isChatAdmin(target.userId, chatId);
    if (isTargetAdmin) {
      await sendAndAutoDelete(ctx, t("errors.cannotKickAdmin"), 0);
      try {
        await ctx.deleteMessage();
      } catch {
        /* ignore */
      }
      return;
    }

    let success = false;
    try {
      markKickInProgress(chatId, target.userId);
      await ctx.api.banChatMember(chatId, target.userId);
      await ctx.api.unbanChatMember(chatId, target.userId);
      success = true;
    } catch (err) {
      logger.error({ action: "kk_kick", userId: target.userId, chatId, error: String(err) });
    }

    try {
      await ctx.deleteMessage();
    } catch {
      /* ignore */
    }

    if (success) {
      await sendAndAutoDelete(ctx, t("kick.kicked", { user: mention(target.name, target.username) }), 0);

      sendLog(ctx.api, ctx.chatConfig, {
        action: "KICK",
        actor: buildActor(ctx),
        target: { id: target.userId, name: target.name, username: target.username },
        chatId,
        chatName: getChatTitle(ctx),
        topicId: ctx.message?.message_thread_id,
        repliedMessage: ctx.message?.reply_to_message
          ? (ctx.message.reply_to_message.text ?? ctx.message.reply_to_message.caption)
          : undefined,
      }).catch(() => {});
    } else {
      await sendAndAutoDelete(ctx, t("errors.kickFailed"), 0);
    }
  } catch {
    // silent fail (G10)
  }
}
