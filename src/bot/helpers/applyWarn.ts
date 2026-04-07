import { BotContext, IChat } from "../../types";
import { userRepository } from "../../db/repositories/userRepository";
import { sendLog } from "./sendLog";

function esc(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function displayName(name: string, username?: string): string {
  return username ? `${esc(name)} (@${esc(username)})` : esc(name);
}

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
  }
): Promise<void> {
  try {
    const user = await userRepository.incrementWarning(targetUserId, chatId, reason, username, name);
    const dn = displayName(name, username);

    const resolvedChatConfig = options?.chatConfig !== undefined ? options.chatConfig : ctx.chatConfig;
    const resolvedChatName = options?.chatName ?? (ctx.chat?.type !== "private" ? (ctx.chat as any)?.title ?? "Unknown" : "Unknown");
    const topicId = options?.topicId ?? ctx.message?.message_thread_id;

    const actor = options?.actor !== undefined
      ? options.actor
      : ctx.from
        ? { id: ctx.from.id, name: ctx.from.first_name + (ctx.from.last_name ? ` ${ctx.from.last_name}` : ""), username: ctx.from.username }
        : undefined;
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
    }).catch(() => {});

    if (user.warnings >= 3) {
      let banMsg = `🚫 <b>${dn} ha sido baneado</b> tras recibir 3 avisos.\n📋 Última razón: ${esc(reason)}`;
      try {
        await ctx.api.banChatMember(chatId, targetUserId);
      } catch {
        banMsg += "\n<i>(Error al ejecutar el ban, hazlo manualmente.)</i>";
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
    } else if (user.warnings === 2) {
      await ctx.api.sendMessage(
        chatId,
        `⚠️ <b>Aviso ${user.warnings}/3</b> para ${dn}\n📋 Razón: ${esc(reason)}\n❗ Un aviso más y será baneado.`,
        { parse_mode: "HTML", message_thread_id: topicId }
      );
    } else {
      await ctx.api.sendMessage(
        chatId,
        `⚠️ <b>Aviso ${user.warnings}/3</b> para ${dn}\n📋 Razón: ${esc(reason)}`,
        { parse_mode: "HTML", message_thread_id: topicId }
      );
    }
  } catch {
    // silent fail
  }
}
