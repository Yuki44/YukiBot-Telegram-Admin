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
      await sendAndAutoDelete(ctx, msg, 3000);
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

    const feedbackPromises: Promise<void>[] = [];

    // 1. Unsilence — reuses qsil feedback
    const silenceSuccess = await unsilenceUser(ctx, target.userId, chatId);
    if (silenceSuccess) {
      feedbackPromises.push(sendAndAutoDelete(ctx, `🕊️ ${mention} ha recuperado su voz.`, 3000));
      sendLog(ctx.api, ctx.chatConfig, {
        action: "Q_SILENCIO",
        actor,
        target: { id: target.userId, name: target.name, username: target.username },
        chatId,
        chatName,
        topicId: ctx.message?.message_thread_id,
      }).catch(() => {});
    } else {
      feedbackPromises.push(sendAndAutoDelete(ctx, "⚠️ No se pudo des-silenciar. ¿Tengo permisos?", 3000));
    }

    // 2. Remove warning — reuses qav feedback
    const user = await userRepository.decrementWarning(target.userId, chatId);
    if (!user) {
      feedbackPromises.push(sendAndAutoDelete(ctx, "❌ Este usuario no tiene avisos registrados.", 3000));
    } else {
      const dn = displayName(target.name, target.username);
      feedbackPromises.push(sendAndAutoDelete(
        ctx,
        `✅ Aviso eliminado para ${dn}.\n📋 Avisos actuales: ${user.warnings}/3`,
        3000
      ));
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

    await Promise.all(feedbackPromises);
    try { await ctx.deleteMessage(); } catch { /* ignore */ }
  } catch {
    // silent fail
  }
}






