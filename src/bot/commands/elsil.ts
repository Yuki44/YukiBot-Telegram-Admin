import { BotContext } from "../../types";
import { sendAndAutoDelete } from "../helpers/sendAndAutoDelete";

export async function elsilHandler(ctx: BotContext): Promise<void> {
  if (!ctx.chatConfig) return;

  try {
    const chatId = ctx.chat!.id;

    if (!ctx.message?.reply_to_message) {
      await ctx.reply("⚠️ Responde al mensaje que quieres eliminar.", { parse_mode: "HTML" });
      return;
    }

    const targetMessageId = ctx.message.reply_to_message.message_id;
    await ctx.api.deleteMessage(chatId, targetMessageId);
    console.log(`[DELETE] message ${targetMessageId} deleted in ${chatId}`);
    try { await ctx.deleteMessage(); } catch { /* ignore */ }
    await sendAndAutoDelete(ctx, `🗑️ Mensaje eliminado.`, 1000);
  } catch {
    // silent fail
  }
}
