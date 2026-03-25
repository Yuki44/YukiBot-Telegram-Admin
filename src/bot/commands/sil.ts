import { BotContext } from "../../types";
import { resolveTarget } from "../helpers/resolveTarget";
import { adminRepository } from "../../db/repositories/adminRepository";
import { silenceUser } from "../helpers/silenceUser";
import { sendAndAutoDelete } from "../helpers/sendAndAutoDelete";

export async function silHandler(ctx: BotContext): Promise<void> {
  if (!ctx.chatConfig) return;

  try {
    const chatId = ctx.chat!.id;
    const args = ctx.match ? String(ctx.match).trim().split(/\s+/).filter(Boolean) : [];

    const target = await resolveTarget(ctx, args);
    if (!target) {
      await ctx.reply("⚠️ Especifica un usuario.", { parse_mode: "HTML" });
      return;
    }

    const isTargetAdmin = await adminRepository.isChatAdmin(target.userId, chatId);
    if (isTargetAdmin) {
      await ctx.reply("❌ No puedes silenciar a un administrador.", { parse_mode: "HTML" });
      return;
    }

    const success = await silenceUser(ctx, target.userId, chatId);
    if (success) {
      try { await ctx.deleteMessage(); } catch { /* ignore */ }
      const mention = target.username ? `@${target.username}` : target.name;
      await sendAndAutoDelete(ctx, `🔇 ${mention} ha sido silenciado por 1 semana.`, 1000);
    } else {
      await ctx.reply("⚠️ No se pudo silenciar. ¿Tengo permisos?", { parse_mode: "HTML" });
    }
  } catch {
    // silent fail
  }
}
