/**
 * Shared orchestrator for all silence-related commands (sil, elsil, silav, elsilav).
 * Consolidates the duplicated resolve → admin-check → delete → silence → log → feedback pattern.
 */

import { BotContext } from "../../types";
import { resolveTarget, ResolvedTarget } from "./resolveTarget";
import { adminRepository } from "../../db/repositories/adminRepository";
import { silenceUser } from "./silenceUser";
import { sendAndAutoDelete } from "./sendAndAutoDelete";
import { sendLog } from "./sendLog";
import { applyWarn } from "./applyWarn";
import { deleteLastMessage } from "./lastMessageTracker";
import { mention } from "./html";
import { parseArgs, buildActor, getChatTitle } from "./contextHelpers";
import { SILENCE_DURATION_MS, AUTO_DELETE_SHORT_MS } from "../../config/constants";
import { t } from "../../locales/i18n";
import { userRepository } from "../../db/repositories/userRepository";
import { logger } from "../../utils/logger";
import { recordActivity } from "../../utils/activityLog";

export interface SilenceOptions {
  /** Delete the target's message (replied-to or last tracked). */
  deleteTargetMsg: boolean;
  /** Also apply a warning (requires a reason). */
  applyWarning: boolean;
}

export async function executeSilence(ctx: BotContext, options: SilenceOptions): Promise<void> {
  if (!ctx.chatConfig) return;

  try {
    const chatId = ctx.chat!.id;
    const args = parseArgs(ctx);
    const hasReply = !!ctx.message?.reply_to_message;

    let target: ResolvedTarget | null = null;
    let replyMessageId: number | undefined;
    let reason = "";

    if (options.deleteTargetMsg && hasReply) {
      // Reply mode: target is the author of the replied-to message
      const replyFrom = ctx.message!.reply_to_message!.from;
      if (!replyFrom) {
        await ctx.reply(t("errors.couldNotIdentifyUser"), {
          parse_mode: "HTML",
          message_thread_id: ctx.message?.message_thread_id,
        });
        try {
          await ctx.deleteMessage();
        } catch {
          /* ignore */
        }
        return;
      }
      target = {
        userId: replyFrom.id,
        username: replyFrom.username,
        name: replyFrom.first_name + (replyFrom.last_name ? ` ${replyFrom.last_name}` : ""),
        resolvedFromArgs: false,
      };
      replyMessageId = ctx.message!.reply_to_message!.message_id;
      reason = args.join(" ").trim();
    } else {
      target = await resolveTarget(ctx, args);
      if (target) {
        const reasonArgs = target.resolvedFromArgs ? args.slice(1) : args;
        reason = reasonArgs.join(" ").trim();
      }
    }

    if (!target) {
      const msg =
        args.length > 0 || ctx.message?.reply_to_message
          ? t("errors.userNotFound")
          : options.deleteTargetMsg
            ? t("errors.replyOrSpecifyUser")
            : t("errors.specifyUser");
      await ctx.reply(msg, {
        parse_mode: "HTML",
        message_thread_id: ctx.message?.message_thread_id,
      });
      try {
        await ctx.deleteMessage();
      } catch {
        /* ignore */
      }
      return;
    }

    if (options.applyWarning && !reason) {
      await ctx.reply(t("errors.specifyReason"), {
        parse_mode: "HTML",
        message_thread_id: ctx.message?.message_thread_id,
      });
      try {
        await ctx.deleteMessage();
      } catch {
        /* ignore */
      }
      return;
    }

    const isTargetAdmin = await adminRepository.isChatAdmin(target.userId, chatId);
    if (isTargetAdmin) {
      await ctx.reply(t("errors.cannotSilenceAdmin"), {
        parse_mode: "HTML",
        message_thread_id: ctx.message?.message_thread_id,
      });
      try {
        await ctx.deleteMessage();
      } catch {
        /* ignore */
      }
      return;
    }

    // Delete the target message if requested
    if (options.deleteTargetMsg) {
      if (replyMessageId) {
        try {
          await ctx.api.deleteMessage(chatId, replyMessageId);
        } catch {
          /* ignore */
        }
      } else {
        await deleteLastMessage(ctx.api, chatId, target.userId);
      }
    }

    const success = await silenceUser(ctx, target.userId, chatId);
    if (success) {
      // Persist mute state so the dashboard's Silenciados tab reflects bot-initiated mutes (G9).
      try {
        await userRepository.upsert({
          userId: target.userId,
          chatId,
          username: target.username,
          name: target.name,
          isMuted: true,
          muteUntil: new Date(Date.now() + SILENCE_DURATION_MS),
        });
      } catch (err) {
        logger.error({ action: "silence.persist", error: String(err), chatId, userId: target.userId });
      }

      try {
        await ctx.deleteMessage();
      } catch {
        /* ignore */
      }
      await sendAndAutoDelete(
        ctx,
        t("silence.silenced", { user: mention(target.name, target.username) }),
        AUTO_DELETE_SHORT_MS
      );

      const actor = buildActor(ctx);
      const chatName = getChatTitle(ctx);
      const repliedMsg = ctx.message?.reply_to_message ?? undefined;
      const refMsgId = ctx.message?.reply_to_message?.message_id;
      sendLog(ctx.api, ctx.chatConfig, {
        action: "SILENCIO",
        actor,
        target: { id: target.userId, name: target.name, username: target.username },
        chatId,
        chatName,
        chatType: ctx.chatConfig.type,
        muteUntil: new Date(Date.now() + SILENCE_DURATION_MS),
        topicId: ctx.message?.message_thread_id,
        refMsgId,
        // Only attach replied message here when there's no AVISO following (which would be last)
        repliedMsg: !options.applyWarning ? repliedMsg : undefined,
      }).catch(() => {});

      recordActivity({
        chatId,
        type: "silence",
        source: "bot",
        actor,
        target: { id: target.userId, name: target.name, username: target.username },
        topicId: ctx.message?.message_thread_id,
        messageText: !options.applyWarning ? repliedMessage : undefined,
      });

      if (options.applyWarning && reason) {
        await applyWarn(ctx, target.userId, chatId, target.name, target.username, reason, {
          refMsgId,
          repliedMsg,
        });
      }
    } else {
      await ctx.reply(t("errors.silenceFailed"), {
        parse_mode: "HTML",
        message_thread_id: ctx.message?.message_thread_id,
      });
    }
  } catch {
    // silent fail (G10)
  }
}
