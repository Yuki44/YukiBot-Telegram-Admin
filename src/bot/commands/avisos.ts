import { BotContext } from "../../types";
import { resolveTarget } from "../helpers/resolveTarget";
import { userRepository } from "../../db/repositories/userRepository";

function esc(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function displayName(name: string, username?: string): string {
  return username ? `${esc(name)} (@${esc(username)})` : esc(name);
}

export async function avisosHandler(ctx: BotContext): Promise<void> {
  if (!ctx.chatConfig) return;

  try {
    const args = ctx.match ? String(ctx.match).trim().split(/\s+/).filter(Boolean) : [];
    const target = await resolveTarget(ctx, args);

    if (!target) {
      const msg = args.length > 0 || ctx.message?.reply_to_message
        ? "⚠️ No se encontró al usuario."
        : "⚠️ Debes especificar un usuario o responder a su mensaje.";
      await ctx.reply(msg, { parse_mode: "HTML" });
      return;
    }

    const chatId = ctx.chat!.id;
    const user = await userRepository.findOrCreate(target.userId, chatId, target.username, target.name);
    const dn = displayName(target.name, target.username);

    let msg = `📋 <b>Avisos de ${dn}</b>: ${user.warnings}/3`;

    if (user.warningReasons && user.warningReasons.length > 0) {
      msg += "\n📝 <b>Razones:</b>";
      user.warningReasons.forEach((reason, i) => {
        msg += `\n${i + 1}. ${esc(reason)}`;
      });
    }

    await ctx.reply(msg, { parse_mode: "HTML" });
    try { await ctx.deleteMessage(); } catch { /* ignore */ }
  } catch {
    // Silently ignore errors
  }
}
