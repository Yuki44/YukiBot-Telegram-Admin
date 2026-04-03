import { BotContext } from "../../types";
import { adminRepository } from "../../db/repositories/adminRepository";
import { silenceUser } from "../helpers/silenceUser";
import { sendAndAutoDelete } from "../helpers/sendAndAutoDelete";
import { applyWarn } from "../helpers/applyWarn";
import { sendLog } from "../helpers/sendLog";

export async function elsilavHandler(ctx: BotContext): Promise<void> {
  if (!ctx.chatConfig) return;

  try {
    const chatId = ctx.chat!.id;

    if (!ctx.message?.reply_to_message) {
      await ctx.reply("⚠️ Responde al mensaje del usuario.", {
        parse_mode: "HTML",
        message_thread_id: ctx.message?.message_thread_id,
      });
      try { await ctx.deleteMessage(); } catch { /* ignore */ }
      return;
    }

    const replyFrom = ctx.message.reply_to_message.from;
    if (!replyFrom) {
      await ctx.reply("⚠️ No se pudo identificar al usuario.", {
        parse_mode: "HTML",
        message_thread_id: ctx.message?.message_thread_id,
      });
      try { await ctx.deleteMessage(); } catch { /* ignore */ }
      return;
    }

    const args = ctx.match ? String(ctx.match).trim().split(/\s+/).filter(Boolean) : [];
    const reason = args.join(" ").trim();

    if (!reason) {
      await ctx.reply("⚠️ Especifica una razón.", {
        parse_mode: "HTML",
        message_thread_id: ctx.message?.message_thread_id,
      });
      try { await ctx.deleteMessage(); } catch { /* ignore */ }
      return;
    }

    const targetUserId = replyFrom.id;
    const targetUsername = replyFrom.username;
    const targetName = replyFrom.first_name + (replyFrom.last_name ? ` ${replyFrom.last_name}` : "");
    const targetMessageId = ctx.message.reply_to_message.message_id;

    const isTargetAdmin = await adminRepository.isChatAdmin(targetUserId, chatId);
    if (isTargetAdmin) {
      await ctx.reply("❌ No puedes silenciar a un administrador.", {
        parse_mode: "HTML",
        message_thread_id: ctx.message?.message_thread_id,
      });
      try { await ctx.deleteMessage(); } catch { /* ignore */ }
      return;
    }

    try {
      await ctx.api.deleteMessage(chatId, targetMessageId);
    } catch { /* ignore */ }

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

      await applyWarn(ctx, targetUserId, chatId, targetName, targetUsername, reason);
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
