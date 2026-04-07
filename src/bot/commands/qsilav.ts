import { BotContext } from "../../types";
import { resolveTarget } from "../helpers/resolveTarget";
import { unsilenceUser } from "../helpers/unsilenceUser";
import { userRepository } from "../../db/repositories/userRepository";
import { sendAndAutoDelete } from "../helpers/sendAndAutoDelete";
import { sendLog } from "../helpers/sendLog";

function esc(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function displayName(name: string, username?: string): string {
  return username ? `${esc(name)} (@${esc(username)})` : esc(name);
}

export async function qsilavHandler(ctx: BotContext): Promise<void> {
  if (!ctx.chatConfig) return;

  try {
    const chatId = ctx.chat!.id;
    const args = ctx.match ? String(ctx.match).trim().split(/\s+/).filter(Boolean) : [];

    const target = await resolveTarget(ctx, args);
    if (!target) {
      const msg =
        args.length > 0 || ctx.message?.reply_to_message
          ? "⚠️ No se encontró al usuario."
          : "⚠️ Especifica un usuario.";
      await ctx.reply(msg, {
        parse_mode: "HTML",
        message_thread_id: ctx.message?.message_thread_id,
      });
      try { await ctx.deleteMessage(); } catch { /* ignore */ }
      return;
    }

    const actor = ctx.from
      ? {
          id: ctx.from.id,
          name: ctx.from.first_name + (ctx.from.last_name ? ` ${ctx.from.last_name}` : ""),
          username: ctx.from.username,
        }
      : undefined;
    const chatName = (ctx.chat as any)?.title ?? "Unknown";
    const mention = target.username ? `@${target.username}` : target.name;

    // 1. Unsilence — reuses qsil feedback
    const silenceSuccess = await unsilenceUser(ctx, target.userId, chatId);
    if (silenceSuccess) {
      await sendAndAutoDelete(ctx, `🕊️ ${mention} ha recuperado su voz.`, 3000);
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

    // 2. Remove warning — reuses qav feedback
    const user = await userRepository.decrementWarning(target.userId, chatId);
    if (!user) {
      await ctx.reply("❌ Este usuario no tiene avisos registrados.", {
        parse_mode: "HTML",
        message_thread_id: ctx.message?.message_thread_id,
      });
    } else {
      const dn = displayName(target.name, target.username);
      await sendAndAutoDelete(
        ctx,
        `✅ Aviso eliminado para ${dn}.\n📋 Avisos actuales: ${user.warnings}/3`,
        1000
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
    }

    try { await ctx.deleteMessage(); } catch { /* ignore */ }
  } catch {
    // silent fail
  }
}

