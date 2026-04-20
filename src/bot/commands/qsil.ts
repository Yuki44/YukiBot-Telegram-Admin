import { BotContext } from "../../types";
import { resolveTarget } from "../helpers/resolveTarget";
import { unsilenceUser } from "../helpers/unsilenceUser";
import { sendAndAutoDelete } from "../helpers/sendAndAutoDelete";
import { sendLog } from "../helpers/sendLog";
import { mention } from "../helpers/html";
import { parseArgs, buildActor, getChatTitle } from "../helpers/contextHelpers";
import { AUTO_DELETE_SHORT_MS } from "../../config/constants";
import { t } from "../../locales/i18n";

export async function qsilHandler(ctx: BotContext): Promise<void> {
  if (!ctx.chatConfig) return;

  try {
    const chatId = ctx.chat!.id;
    const args = parseArgs(ctx);

    const target = await resolveTarget(ctx, args);
    if (!target) {
      const msg =
        args.length > 0 || ctx.message?.reply_to_message ? t("errors.userNotFound") : t("errors.specifyUser");
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

    const success = await unsilenceUser(ctx, target.userId, chatId);
    if (success) {
      try {
        await ctx.deleteMessage();
      } catch {
        /* ignore */
      }
      await sendAndAutoDelete(
        ctx,
        t("silence.unsilenced", { user: mention(target.name, target.username) }),
        AUTO_DELETE_SHORT_MS
      );

      sendLog(ctx.api, ctx.chatConfig, {
        action: "Q_SILENCIO",
        actor: buildActor(ctx),
        target: { id: target.userId, name: target.name, username: target.username },
        chatId,
        chatName: getChatTitle(ctx),
        topicId: ctx.message?.message_thread_id,
      }).catch(() => {});
    } else {
      await ctx.reply(t("errors.unsilenceFailed"), {
        parse_mode: "HTML",
        message_thread_id: ctx.message?.message_thread_id,
      });
    }
  } catch {
    // silent fail (G10)
  }
}
