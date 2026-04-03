import { BotContext } from "../../types";
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
  reason: string
): Promise<void> {
  try {
    const user = await userRepository.incrementWarning(targetUserId, chatId, reason, username, name);
    const dn = displayName(name, username);

    const actor = ctx.from
      ? { id: ctx.from.id, name: ctx.from.first_name + (ctx.from.last_name ? ` ${ctx.from.last_name}` : ""), username: ctx.from.username }
      : undefined;
    const target = { id: targetUserId, name, username };
    const chatName = ctx.chat?.type !== "private" ? (ctx.chat as any)?.title ?? "Unknown" : "Unknown";
    const topicId = ctx.message?.message_thread_id;

    // Log AVISO (every warn)
    sendLog(ctx.api, ctx.chatConfig, {
      action: "AVISO",
      actor,
      target,
      chatId,
      chatName,
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
      await ctx.reply(banMsg, {
        parse_mode: "HTML",
        message_thread_id: ctx.message?.message_thread_id,
      });

      // Log BAN
      sendLog(ctx.api, ctx.chatConfig, {
        action: "BAN",
        actor,
        target,
        chatId,
        chatName,
        reason: "3 avisos",
        topicId,
      }).catch(() => {});
    } else if (user.warnings === 2) {
      await ctx.reply(
        `⚠️ <b>Aviso ${user.warnings}/3</b> para ${dn}\n📋 Razón: ${esc(reason)}\n❗ Un aviso más y será baneado.`,
        {
          parse_mode: "HTML",
          message_thread_id: ctx.message?.message_thread_id,
        }
      );
    } else {
      await ctx.reply(
        `⚠️ <b>Aviso ${user.warnings}/3</b> para ${dn}\n📋 Razón: ${esc(reason)}`,
        {
          parse_mode: "HTML",
          message_thread_id: ctx.message?.message_thread_id,
        }
      );
    }
  } catch {
    // silent fail
  }
}
