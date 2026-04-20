import { BotContext } from "../../types";
import { logger } from "../../utils/logger";

export async function sendAndAutoDelete(ctx: BotContext, text: string, delayMs: number): Promise<void> {
  let sent: Awaited<ReturnType<typeof ctx.reply>> | undefined;
  try {
    sent = await ctx.reply(text, {
      parse_mode: "HTML",
      message_thread_id: ctx.message?.message_thread_id,
    });
  } catch (err) {
    logger.error({ action: "sendAndAutoDelete_send", chatId: ctx.chat?.id, error: String(err) });
    return;
  }

  try {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    await ctx.api.deleteMessage(ctx.chat!.id, sent.message_id);
  } catch (err) {
    logger.error({
      action: "sendAndAutoDelete_delete",
      chatId: ctx.chat?.id,
      messageId: sent.message_id,
      error: String(err),
    });
  }
}
