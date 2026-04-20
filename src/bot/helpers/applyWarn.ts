import { BotContext, IChat } from "../../types";
import { userRepository } from "../../db/repositories/userRepository";
import { sendLog } from "./sendLog";
import { esc, displayName } from "./html";
import { buildActor, getChatTitle } from "./contextHelpers";
import { MAX_WARNINGS } from "../../config/constants";
import { t } from "../../locales/i18n";

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
): Promise<void> {
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

    if (user.warnings >= MAX_WARNINGS) {
      let banMsg = t("warnings.autoBan", { user: dn, max: MAX_WARNINGS, reason: esc(reason) });
      try {
        await ctx.api.banChatMember(chatId, targetUserId);
      } catch {
        banMsg += `\n${t("errors.banExecFailed")}`;
      }
      await ctx.api.sendMessage(chatId, banMsg, { parse_mode: "HTML", message_thread_id: topicId });

      sendLog(ctx.api, resolvedChatConfig, {
        action: "BAN",
        actor,
        target,
        chatId,
        chatName: resolvedChatName,
        reason: "3 avisos",
        topicId,
      }).catch(() => {});
    } else if (user.warnings === MAX_WARNINGS - 1) {
      await ctx.api.sendMessage(
        chatId,
        t("warnings.warnLastChance", {
          current: user.warnings,
          max: MAX_WARNINGS,
          user: dn,
          reason: esc(reason),
        }),
        { parse_mode: "HTML", message_thread_id: topicId }
      );
    } else {
      await ctx.api.sendMessage(
        chatId,
        t("warnings.warnNotice", {
          current: user.warnings,
          max: MAX_WARNINGS,
          user: dn,
          reason: esc(reason),
        }),
        { parse_mode: "HTML", message_thread_id: topicId }
      );
    }
  } catch {
    // silent fail
  }
}
