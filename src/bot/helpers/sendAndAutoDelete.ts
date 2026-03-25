import { BotContext } from "../../types";

export async function sendAndAutoDelete(
  ctx: BotContext,
  text: string,
  delayMs: number
): Promise<void> {
  let sent: Awaited<ReturnType<typeof ctx.reply>> | undefined;
  try {
    sent = await ctx.reply(text, { parse_mode: "HTML" });
  } catch (err) {
    console.error("[AUTO-DELETE] failed to send message:", err);
    return;
  }

  // Message confirmed in chat — schedule deletion (visible in Recent Actions)
  console.log(`[AUTO-DELETE] message ${sent.message_id} sent, deleting in ${delayMs}ms`);
  try {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    await ctx.api.deleteMessage(ctx.chat!.id, sent.message_id);
    console.log(`[AUTO-DELETE] deleted message ${sent.message_id}`);
  } catch (err) {
    console.error(`[AUTO-DELETE] failed to delete message ${sent.message_id}:`, err);
  }
}
