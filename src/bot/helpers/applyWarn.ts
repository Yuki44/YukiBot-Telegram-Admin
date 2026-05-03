import { BotContext, IChat } from "../../types";
import { userRepository } from "../../db/repositories/userRepository";
import { sendLog } from "./sendLog";
import { esc, displayName } from "./html";
import { buildActor, getChatTitle } from "./contextHelpers";
import { MAX_WARNINGS } from "../../config/constants";
import { t } from "../../locales/i18n";
import { recordActivity } from "../../utils/activityLog";

export async function applyWarn(
  ctx: BotContext,
  targetUserId: number,
  chatId: number,
  name: string,
  username: string | undefined,
  reason: string,
  options?: {
    chatConfig?: IChat | null;
    chatName?: string;
    topicId?: number;
    actor?: { id: number; name: string; username?: string };
    repliedMessage?: string;
  }
): Promise<{ warnMsgId?: number }> {
  try {
    const user = await userRepository.incrementWarning(targetUserId, chatId, reason, username, name);
    const dn = displayName(name, username);

    const resolvedChatConfig = options?.chatConfig !== undefined ? options.chatConfig : ctx.chatConfig;
    const resolvedChatName = options?.chatName ?? getChatTitle(ctx);
    const topicId = options?.topicId ?? ctx.message?.message_thread_id;

    const actor = options?.actor !== undefined ? options.actor : buildActor(ctx);
    const target = { id: targetUserId, name, username };

    sendLog(ctx.api, resolvedChatConfig, {
      action: "AVISO",
      actor,
      target,
      chatId,
      chatName: resolvedChatName,
      warnings: user.warnings,
      reason,
      topicId,
      repliedMessage: options?.repliedMessage,
    }).catch(() => {});

    recordActivity({
      chatId,
      type: "warn",
      source: "bot",
      actor,
      target,
      reason,
      topicId,
      warningsAfter: user.warnings,
      messageText: options?.repliedMessage,
    });

    let warnMsgId: number | undefined;

    if (user.warnings >= MAX_WARNINGS) {
      let banMsg = t("warnings.autoBan", { user: dn, max: MAX_WARNINGS, reason: esc(reason) });
      try {
        await ctx.api.banChatMember(chatId, targetUserId);
      } catch {
        banMsg += `\n${t("errors.banExecFailed")}`;
      }
      const sent = await ctx.api.sendMessage(chatId, banMsg, {
        parse_mode: "HTML",
        message_thread_id: topicId,
      });
      warnMsgId = sent.message_id;

      sendLog(ctx.api, resolvedChatConfig, {
        action: "BAN",
        actor,
        target,
        chatId,
        chatName: resolvedChatName,
        reason: "3 avisos",
        topicId,
      }).catch(() => {});

      recordActivity({
        chatId,
        type: "autoban",
        source: "bot",
        actor,
        target,
        reason: "3/3 avisos",
        topicId,
      });
    } else if (user.warnings === MAX_WARNINGS - 1) {
      const sent = await ctx.api.sendMessage(
        chatId,
        t("warnings.warnLastChance", {
          current: user.warnings,
          max: MAX_WARNINGS,
          user: dn,
          reason: esc(reason),
        }),
        { parse_mode: "HTML", message_thread_id: topicId }
      );
      warnMsgId = sent.message_id;
    } else {
      const sent = await ctx.api.sendMessage(
        chatId,
        t("warnings.warnNotice", {
          current: user.warnings,
          max: MAX_WARNINGS,
          user: dn,
          reason: esc(reason),
        }),
        { parse_mode: "HTML", message_thread_id: topicId }
      );
      warnMsgId = sent.message_id;
    }

    return { warnMsgId };
  } catch {
    return {};
  }
}
