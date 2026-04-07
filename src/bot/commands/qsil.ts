import { BotContext } from "../../types";
import { resolveTarget } from "../helpers/resolveTarget";
import { unsilenceUser } from "../helpers/unsilenceUser";
import { sendAndAutoDelete } from "../helpers/sendAndAutoDelete";
import { sendLog } from "../helpers/sendLog";

export async function qsilHandler(ctx: BotContext): Promise<void> {
  if (!ctx.chatConfig) return;

  try {
    const chatId = ctx.chat!.id;
    const args = ctx.match ? String(ctx.match).trim().split(/\s+/).filter(Boolean) : [];

    const target = await resolveTarget(ctx, args);
    if (!target) {
      const msg = args.length > 0 || ctx.message?.reply_to_message
        ? "⚠️ No se encontró al usuario."
        : "⚠️ Especifica un usuario.";
      await ctx.reply(msg, {
        parse_mode: "HTML",
        message_thread_id: ctx.message?.message_thread_id,
      });
      try { await ctx.deleteMessage(); } catch { /* ignore */ }
      return;
    }

    const success = await unsilenceUser(ctx, target.userId, chatId);
    if (success) {
      try { await ctx.deleteMessage(); } catch { /* ignore */ }
      const mention = target.username ? `@${target.username}` : target.name;
      await sendAndAutoDelete(ctx, `🕊️ ${mention} ha recuperado su voz.`, 1000);

      const actor = ctx.from
        ? { id: ctx.from.id, name: ctx.from.first_name + (ctx.from.last_name ? ` ${ctx.from.last_name}` : ""), username: ctx.from.username }
        : undefined;
      const chatName = (ctx.chat as any)?.title ?? "Unknown";
      sendLog(ctx.api, ctx.chatConfig, {
        action: "Q_SILENCIO",
        actor,
        target: { id: target.userId, name: target.name, username: target.username },
        chatId,
        chatName,
        topicId: ctx.message?.message_thread_id,
      }).catch(() => {});
    } else {
      await ctx.reply("⚠️ No se pudo des-silenciar. ¿Tengo permisos?", {
        parse_mode: "HTML",
        message_thread_id: ctx.message?.message_thread_id,
      });
    }
  } catch {
    // silent fail
  }
}
