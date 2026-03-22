import { BotContext } from "../../types";

export interface ResolvedTarget {
  userId: number;
  username?: string;
  name: string;
  resolvedFromArgs: boolean;
}

export async function resolveTarget(
  ctx: BotContext,
  args: string[]
): Promise<ResolvedTarget | null> {
  try {
    const chatId = ctx.chat!.id;

    // Numeric user ID in args takes priority over reply
    if (args[0] && /^\d+$/.test(args[0])) {
      const userId = parseInt(args[0], 10);
      try {
        const member = await ctx.api.getChatMember(chatId, userId);
        return {
          userId: member.user.id,
          username: member.user.username,
          name: member.user.first_name,
          resolvedFromArgs: true,
        };
      } catch {
        return null;
      }
    }

    // Fall back to replied-to message
    if (ctx.message?.reply_to_message?.from) {
      const from = ctx.message.reply_to_message.from;
      return {
        userId: from.id,
        username: from.username,
        name: from.first_name,
        resolvedFromArgs: false,
      };
    }

    return null;
  } catch {
    return null;
  }
}
