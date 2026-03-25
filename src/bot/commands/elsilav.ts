import { BotContext } from "../../types";
import { adminRepository } from "../../db/repositories/adminRepository";
import { silenceUser } from "../helpers/silenceUser";
import { sendAndAutoDelete } from "../helpers/sendAndAutoDelete";
import { applyWarn } from "../helpers/applyWarn";

export async function elsilavHandler(ctx: BotContext): Promise<void> {
  if (!ctx.chatConfig) return;

  try {
    const chatId = ctx.chat!.id;

    if (!ctx.message?.reply_to_message) {
      await ctx.reply("⚠️ Responde al mensaje del usuario.", { parse_mode: "HTML" });
      return;
    }

    const replyFrom = ctx.message.reply_to_message.from;
    if (!replyFrom) {
      await ctx.reply("⚠️ No se pudo identificar al usuario.", { parse_mode: "HTML" });
      return;
    }

    const args = ctx.match ? String(ctx.match).trim().split(/\s+/).filter(Boolean) : [];
    const reason = args.join(" ").trim();

    if (!reason) {
      await ctx.reply("⚠️ Especifica una razón.", { parse_mode: "HTML" });
      return;
    }

    const targetUserId = replyFrom.id;
    const targetUsername = replyFrom.username;
    const targetName = replyFrom.first_name + (replyFrom.last_name ? ` ${replyFrom.last_name}` : "");
    const targetMessageId = ctx.message.reply_to_message.message_id;

    const isTargetAdmin = await adminRepository.isChatAdmin(targetUserId, chatId);
    if (isTargetAdmin) {
      await ctx.reply("❌ No puedes silenciar a un administrador.", { parse_mode: "HTML" });
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
      await applyWarn(ctx, targetUserId, chatId, targetName, targetUsername, reason);
    } else {
      await ctx.reply("⚠️ No se pudo silenciar. ¿Tengo permisos?", { parse_mode: "HTML" });
    }
  } catch {
    // silent fail
  }
}
