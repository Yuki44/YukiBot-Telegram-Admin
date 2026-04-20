import { NextFunction } from "grammy";
import { BotContext } from "../../types";

const YUKIBOT_COMMANDS = new Set([
  "setup",
  "addtopic",
  "edittopic",
  "removetopic",
  "togglefeature",
  "av",
  "elav",
  "qav",
  "avs",
  "qban",
  "sil",
  "elsil",
  "silav",
  "elsilav",
  "qsil",
  "qsilav",
  "com",
  "kk",
  "bn",
]);

export async function adminOnlyCommands(ctx: BotContext, next: NextFunction): Promise<void> {
  const text = ctx.message?.text || ctx.message?.caption;

  if (text?.startsWith("/")) {
    const match = text.match(/^\/([a-zA-Z_]+)/);
    const command = match?.[1]?.toLowerCase();

    if (command && YUKIBOT_COMMANDS.has(command)) {
      if (!ctx.isAdmin) {
        try {
          await ctx.deleteMessage();
        } catch {}
        return;
      }
    }
  }

  await next();
}
