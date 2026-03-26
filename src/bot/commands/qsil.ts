import { BotContext } from "../../types";
import { resolveTarget } from "../helpers/resolveTarget";
import { unsilenceUser } from "../helpers/unsilenceUser";
import { sendAndAutoDelete } from "../helpers/sendAndAutoDelete";

export async function qsilHandler(ctx: BotContext): Promise<void> {
  if (!ctx.chatConfig) return;

  try {
    const chatId = ctx.chat!.id;
    const args = ctx.match ? String(ctx.match).trim().split(/\s+/).filter(Boolean) : [];

    const target = await resolveTarget(ctx, args);
    if (!target) {
      await ctx.reply("⚠️ Especifica un usuario.", { parse_mode: "HTML" });
      return;
    }

    const success = await unsilenceUser(ctx, target.userId, chatId);
    if (success) {
      try { await ctx.deleteMessage(); } catch { /* ignore */ }
      const mention = target.username ? `@${target.username}` : target.name;
      await sendAndAutoDelete(ctx, `🕊️ ${mention} ha recuperado su voz.`, 3000);
    } else {
      await ctx.reply("⚠️ No se pudo des-silenciar. ¿Tengo permisos?", { parse_mode: "HTML" });
    }
  } catch {
    // silent fail
  }
}
