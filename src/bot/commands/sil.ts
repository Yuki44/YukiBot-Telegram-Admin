import { BotContext } from "../../types";
import { resolveTarget } from "../helpers/resolveTarget";
import { adminRepository } from "../../db/repositories/adminRepository";
import { silenceUser } from "../helpers/silenceUser";
import { sendAndAutoDelete } from "../helpers/sendAndAutoDelete";
import { sendLog } from "../helpers/sendLog";

export async function silHandler(ctx: BotContext): Promise<void> {
  if (!ctx.chatConfig) return;

  try {
    const chatId = ctx.chat!.id;
    const args = ctx.match ? String(ctx.match).trim().split(/\s+/).filter(Boolean) : [];

    const target = await resolveTarget(ctx, args);
    if (!target) {
      console.log(`[silHandler] Target not resolved in chat ${chatId}. Args:`, args);
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

    console.log(`[silHandler] Target resolved: ${target.userId} (${target.username || 'no username'}) in chat ${chatId}`);

    const isTargetAdmin = await adminRepository.isChatAdmin(target.userId, chatId);
    
    if (isTargetAdmin) {
      await ctx.reply("❌ No puedes silenciar a un administrador.", {
        parse_mode: "HTML",
        message_thread_id: ctx.message?.message_thread_id,
      });
      try { await ctx.deleteMessage(); } catch { /* ignore */ }
      return;
    }

    const success = await silenceUser(ctx, target.userId, chatId);
    if (success) {
      try { await ctx.deleteMessage(); } catch { /* ignore */ }
      const mention = target.username ? `@${target.username}` : target.name;
      await sendAndAutoDelete(ctx, `🔇 ${mention} ha sido silenciado por 1 semana.`, 5000);

      const actor = ctx.from
        ? { id: ctx.from.id, name: ctx.from.first_name + (ctx.from.last_name ? ` ${ctx.from.last_name}` : ""), username: ctx.from.username }
        : undefined;
      const chatName = (ctx.chat as any)?.title ?? "Unknown";
      sendLog(ctx.api, ctx.chatConfig, {
        action: "SILENCIO",
        actor,
        target: { id: target.userId, name: target.name, username: target.username },
        chatId,
        chatName,
        muteUntil: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        topicId: ctx.message?.message_thread_id,
      }).catch(() => {});
    } else {
      await ctx.reply("⚠️ No se pudo silenciar. ¿Tengo permisos?", {
        parse_mode: "HTML",
        message_thread_id: ctx.message?.message_thread_id,
      });
    }
  } catch {
    // silent fail
  }
}
