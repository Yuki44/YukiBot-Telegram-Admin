import { BotContext } from "../../types";
import { adminRepository } from "../../db/repositories/adminRepository";
import { resolveTarget } from "../helpers/resolveTarget";
import { silenceUser } from "../helpers/silenceUser";
import { sendAndAutoDelete } from "../helpers/sendAndAutoDelete";
import { sendLog } from "../helpers/sendLog";
import { deleteLastMessage } from "../helpers/lastMessageTracker";

export async function elsilHandler(ctx: BotContext): Promise<void> {
  if (!ctx.chatConfig) return;

  try {
    const chatId = ctx.chat!.id;
    const hasReply = !!ctx.message?.reply_to_message;
    const args = ctx.match ? String(ctx.match).trim().split(/\s+/).filter(Boolean) : [];

    let targetUserId: number;
    let targetUsername: string | undefined;
    let targetName: string;
    let replyMessageId: number | undefined;

    if (hasReply) {
      // Reply mode: target is the author of the replied-to message
      const replyFrom = ctx.message!.reply_to_message!.from;
      if (!replyFrom) {
        await ctx.reply("⚠️ No se pudo identificar al usuario.", {
          parse_mode: "HTML",
          message_thread_id: ctx.message?.message_thread_id,
        });
        try { await ctx.deleteMessage(); } catch { /* ignore */ }
        return;
      }
      targetUserId = replyFrom.id;
      targetUsername = replyFrom.username;
      targetName = replyFrom.first_name + (replyFrom.last_name ? ` ${replyFrom.last_name}` : "");
      replyMessageId = ctx.message!.reply_to_message!.message_id;
    } else {
      // No reply: resolve target from args (@username or numeric userId)
      const target = await resolveTarget(ctx, args);
      if (!target) {
        const msg = args.length > 0
          ? "⚠️ No se encontró al usuario."
          : "⚠️ Responde al mensaje que quieres eliminar o especifica un usuario.";
        await ctx.reply(msg, {
          parse_mode: "HTML",
          message_thread_id: ctx.message?.message_thread_id,
        });
        try { await ctx.deleteMessage(); } catch { /* ignore */ }
        return;
      }
      targetUserId = target.userId;
      targetUsername = target.username;
      targetName = target.name;
    }

    const isTargetAdmin = await adminRepository.isChatAdmin(targetUserId, chatId);
    if (isTargetAdmin) {
      await ctx.reply("❌ No puedes silenciar a un administrador.", {
        parse_mode: "HTML",
        message_thread_id: ctx.message?.message_thread_id,
      });
      try { await ctx.deleteMessage(); } catch { /* ignore */ }
      return;
    }

    // Delete the target message (replied-to, or last tracked message)
    if (replyMessageId) {
      try { await ctx.api.deleteMessage(chatId, replyMessageId); } catch { /* ignore */ }
    } else {
      await deleteLastMessage(ctx.api, chatId, targetUserId);
    }

    const success = await silenceUser(ctx, targetUserId, chatId);
    if (success) {
      try { await ctx.deleteMessage(); } catch { /* ignore */ }
      const mention = targetUsername ? `@${targetUsername}` : targetName;
      await sendAndAutoDelete(ctx, `🔇 ${mention} ha sido silenciado por 1 semana.`, 1000);

      const actor = ctx.from
        ? { id: ctx.from.id, name: ctx.from.first_name + (ctx.from.last_name ? ` ${ctx.from.last_name}` : ""), username: ctx.from.username }
        : undefined;
      const chatName = (ctx.chat as any)?.title ?? "Unknown";
      sendLog(ctx.api, ctx.chatConfig, {
        action: "SILENCIO",
        actor,
        target: { id: targetUserId, name: targetName, username: targetUsername },
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
