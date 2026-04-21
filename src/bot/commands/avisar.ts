import { BotContext } from "../../types";
import { resolveTarget } from "../helpers/resolveTarget";
import { adminRepository } from "../../db/repositories/adminRepository";
import { applyWarn } from "../helpers/applyWarn";
import { deleteLastMessage } from "../helpers/lastMessageTracker";
import { parseArgs } from "../helpers/contextHelpers";
import { t } from "../../locales/i18n";

async function executeAvisar(ctx: BotContext, deleteReplied: boolean): Promise<void> {
  if (!ctx.chatConfig) return;

  const chatId = ctx.chat!.id;
  const senderId = ctx.from?.id;
  const args = parseArgs(ctx);

  const target = await resolveTarget(ctx, args);

  if (!target) {
    const msg =
      args.length > 0 || ctx.message?.reply_to_message
        ? t("errors.userNotFound")
        : t("errors.specifyUserOrReply");
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

  if (target.userId === senderId) {
    try {
      await ctx.deleteMessage();
    } catch {
      /* ignore */
    }
    return;
  }

  const isTargetAdmin = await adminRepository.isChatAdmin(target.userId, chatId);
  if (isTargetAdmin) {
    try {
      await ctx.deleteMessage();
    } catch {
      /* ignore */
    }
    return;
  }

  // If target was resolved from args[0], reason starts at args[1]; otherwise all args are the reason
  const reasonArgs = target.resolvedFromArgs ? args.slice(1) : args;
  const reason = reasonArgs.join(" ").trim();

  if (!reason) {
    await ctx.reply(t("errors.specifyReasonForWarn"), {
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

  if (deleteReplied) {
    if (ctx.message?.reply_to_message?.message_id) {
      try {
        await ctx.api.deleteMessage(chatId, ctx.message.reply_to_message.message_id);
      } catch {
        /* ignore */
      }
    } else {
      await deleteLastMessage(ctx.api, chatId, target.userId);
    }
  }

  await applyWarn(ctx, target.userId, chatId, target.name, target.username, reason, {
    refMsgId: ctx.message?.reply_to_message?.message_id,
    repliedMsg: ctx.message?.reply_to_message ?? undefined,
  });

  try {
    await ctx.deleteMessage();
  } catch {
    /* ignore */
  }
}

export async function avisarHandler(ctx: BotContext): Promise<void> {
  await executeAvisar(ctx, false);
}

export async function elAvisarHandler(ctx: BotContext): Promise<void> {
  await executeAvisar(ctx, true);
}
