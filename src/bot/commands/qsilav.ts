import { BotContext } from "../../types";
import { resolveTarget } from "../helpers/resolveTarget";
import { unsilenceUser } from "../helpers/unsilenceUser";
import { userRepository } from "../../db/repositories/userRepository";
import { sendAndAutoDelete } from "../helpers/sendAndAutoDelete";
import { sendLog } from "../helpers/sendLog";
import { displayName, mention } from "../helpers/html";
import { parseArgs, buildActor, getChatTitle } from "../helpers/contextHelpers";
import { AUTO_DELETE_SHORT_MS, MAX_WARNINGS } from "../../config/constants";
import { t } from "../../locales/i18n";
import { recordActivity } from "../../utils/activityLog";

export async function qsilavHandler(ctx: BotContext): Promise<void> {
  if (!ctx.chatConfig) return;

  try {
    const chatId = ctx.chat!.id;
    const args = parseArgs(ctx);

    const target = await resolveTarget(ctx, args);
    if (!target) {
      const msg =
        args.length > 0 || ctx.message?.reply_to_message ? t("errors.userNotFound") : t("errors.specifyUser");
      await sendAndAutoDelete(ctx, msg, AUTO_DELETE_SHORT_MS);
      try {
        await ctx.deleteMessage();
      } catch {
        /* ignore */
      }
      return;
    }

    const actor = buildActor(ctx);
    const chatName = getChatTitle(ctx);
    const feedbackPromises: Promise<void>[] = [];

    // 1. Unsilence
    const silenceSuccess = await unsilenceUser(ctx, target.userId, chatId);
    if (silenceSuccess) {
      // Mirror the mute lift in the DB so the dashboard reflects it (G9).
      try {
        await userRepository.upsert({
          userId: target.userId,
          chatId,
          isMuted: false,
          muteUntil: undefined,
        });
      } catch {
        /* silent (G10) */
      }

      feedbackPromises.push(
        sendAndAutoDelete(
          ctx,
          t("silence.unsilenced", { user: mention(target.name, target.username) }),
          AUTO_DELETE_SHORT_MS
        )
      );
      sendLog(ctx.api, ctx.chatConfig, {
        action: "Q_SILENCIO",
        actor,
        target: { id: target.userId, name: target.name, username: target.username },
        chatId,
        chatName,
        topicId: ctx.message?.message_thread_id,
      }).catch(() => {});

      recordActivity({
        chatId,
        type: "unsilence",
        source: "bot",
        actor,
        target: { id: target.userId, name: target.name, username: target.username },
        topicId: ctx.message?.message_thread_id,
      });
    } else {
      feedbackPromises.push(sendAndAutoDelete(ctx, t("errors.unsilenceFailed"), AUTO_DELETE_SHORT_MS));
    }

    // 2. Remove warning
    const user = await userRepository.decrementWarning(target.userId, chatId);
    if (!user) {
      feedbackPromises.push(sendAndAutoDelete(ctx, t("errors.noWarningsRecorded"), AUTO_DELETE_SHORT_MS));
    } else {
      const dn = displayName(target.name, target.username);
      feedbackPromises.push(
        sendAndAutoDelete(
          ctx,
          t("warnings.warningRemoved", { user: dn, current: user.warnings, max: MAX_WARNINGS }),
          AUTO_DELETE_SHORT_MS
        )
      );
      sendLog(ctx.api, ctx.chatConfig, {
        action: "Q_AVISO",
        actor,
        target: { id: target.userId, name: target.name, username: target.username },
        chatId,
        chatName,
        warnings: user.warnings,
        topicId: ctx.message?.message_thread_id,
      }).catch(() => {});

      recordActivity({
        chatId,
        type: "unwarn",
        source: "bot",
        actor,
        target: { id: target.userId, name: target.name, username: target.username },
        warningsAfter: user.warnings,
        topicId: ctx.message?.message_thread_id,
      });
    }

    await Promise.all(feedbackPromises);
    try {
      await ctx.deleteMessage();
    } catch {
      /* ignore */
    }
  } catch {
    // silent fail (G10)
  }
}
