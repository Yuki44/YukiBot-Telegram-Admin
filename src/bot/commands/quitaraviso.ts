import { BotContext } from "../../types";
import { resolveTarget } from "../helpers/resolveTarget";
import { userRepository } from "../../db/repositories/userRepository";
import { sendLog } from "../helpers/sendLog";
import { sendAndAutoDelete } from "../helpers/sendAndAutoDelete";
import { displayName } from "../helpers/html";
import { parseArgs, buildActor, getChatTitle } from "../helpers/contextHelpers";
import { AUTO_DELETE_SHORT_MS, MAX_WARNINGS } from "../../config/constants";
import { t } from "../../locales/i18n";

async function executeQuitarAviso(ctx: BotContext, deleteReplied: boolean): Promise<void> {
  if (!ctx.chatConfig) return;

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

  const chatId = ctx.chat!.id;
  const user = await userRepository.decrementWarning(target.userId, chatId);

  if (!user) {
    await ctx.reply(t("errors.noWarningsRecorded"), {
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

  if (deleteReplied && ctx.message?.reply_to_message?.message_id) {
    try {
      await ctx.api.deleteMessage(chatId, ctx.message.reply_to_message.message_id);
    } catch {
      // Silently ignore if delete fails
    }
  }

  const dn = displayName(target.name, target.username);
  await sendAndAutoDelete(
    ctx,
    t("warnings.warningRemoved", { user: dn, current: user.warnings, max: MAX_WARNINGS }),
    AUTO_DELETE_SHORT_MS
  );

  sendLog(ctx.api, ctx.chatConfig, {
    action: "Q_AVISO",
    actor: buildActor(ctx),
    target: { id: target.userId, name: target.name, username: target.username },
    chatId,
    chatName: getChatTitle(ctx),
    chatType: ctx.chatConfig.type,
    warnings: user.warnings,
    topicId: ctx.message?.message_thread_id,
  }).catch(() => {});

  try {
    await ctx.deleteMessage();
  } catch {
    /* ignore */
  }
}

export async function quitarAvisoHandler(ctx: BotContext): Promise<void> {
  await executeQuitarAviso(ctx, false);
}
