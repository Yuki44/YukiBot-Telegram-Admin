import { MessageEntity } from "grammy/types";
import { BotContext } from "../../types";
import { userRepository } from "../../db/repositories/userRepository";
import { adminRepository } from "../../db/repositories/adminRepository";
import { logger } from "../../utils/logger";

type TextMentionEntity = Extract<MessageEntity, { type: "text_mention" }>;

export interface ResolvedTarget {
  userId: number;
  username?: string;
  name: string;
  resolvedFromArgs: boolean;
}

export async function resolveTarget(ctx: BotContext, args: string[]): Promise<ResolvedTarget | null> {
  const message = ctx.message;
  const chatId = ctx.chat!.id;

  logger.info({ action: "resolveTarget", chatId, args: args.join(",") });

  // Check if args[0] is a potential target BEFORE checking for reply_to_message.
  // This avoids accidental self-targets or misidentifications when a reply exists but isn't the intended target.
  const hasTargetInArgs =
    args[0] &&
    (args[0].startsWith("@") || // Mention or username
      /^\d+$/.test(args[0]) || // Numeric user ID
      message?.entities?.some(
        (e) =>
          e.type === "text_mention" &&
          (e.offset === 0 || (message.text || message.caption || "").substring(0, e.offset).trim() === "")
      ));

  // Priority 1: If an explicit target is in the arguments, it OVERRIDES the reply
  if (hasTargetInArgs) {
    logger.info({ action: "resolveTarget", chatId, method: "args", arg: args[0] });
  } else if (message?.reply_to_message?.from) {
    // Priority 2: reply — only if NO target in args
    const u = message.reply_to_message.from;
    logger.info({ action: "resolveTarget", chatId, method: "reply", userId: u.id });
    return {
      userId: u.id,
      username: u.username,
      name: u.first_name,
      resolvedFromArgs: false,
    };
  }

  if (!args[0]) return null;

  // Priority 2: text_mention entity (Telegram autocomplete) — full user object, zero API calls
  const mention = message?.entities?.find((e): e is TextMentionEntity => e.type === "text_mention");
  if (mention) {
    logger.info({ action: "resolveTarget", chatId, method: "text_mention", userId: mention.user.id });
    return {
      userId: mention.user.id,
      username: mention.user.username,
      name: mention.user.first_name,
      resolvedFromArgs: true,
    };
  }

  // Priority 3: @username string
  if (args[0].startsWith("@")) {
    const usernameWithoutAt = args[0].slice(1);

    // 3a: DB cache (populated by trackUser middleware) — zero API calls
    const cached = await userRepository.findByUsername(usernameWithoutAt, Number(chatId));
    if (cached) {
      logger.info({ action: "resolveTarget", chatId, method: "userDB", userId: cached.userId });
      return {
        userId: cached.userId,
        username: cached.username,
        name: cached.name ?? String(cached.userId),
        resolvedFromArgs: true,
      };
    }

    // 3b: Admin collection fallback (admins may not be in User collection for older chats)
    const cachedAdmin = await adminRepository.findByUsername(usernameWithoutAt, Number(chatId));
    if (cachedAdmin) {
      logger.info({ action: "resolveTarget", chatId, method: "adminDB", userId: cachedAdmin.userId });
      // Populate User collection for future lookups
      userRepository
        .findOrCreate(cachedAdmin.userId, chatId, cachedAdmin.username || undefined, cachedAdmin.name)
        .catch(() => {
          /* ignore */
        });
      return {
        userId: cachedAdmin.userId,
        username: cachedAdmin.username || undefined,
        name: cachedAdmin.name,
        resolvedFromArgs: true,
      };
    }

    logger.warn({ action: "resolveTarget", chatId, method: "username_miss", username: usernameWithoutAt });
    // 3c: API fallback for users not yet in cache
    return null;
  }

  // Priority 4: numeric userId — one API call, graceful fallback if user left
  if (/^\d+$/.test(args[0])) {
    const userId = parseInt(args[0], 10);
    try {
      const member = await ctx.api.getChatMember(Number(chatId), userId);
      logger.info({ action: "resolveTarget", chatId, method: "getChatMember", userId: member.user.id });
      return {
        userId: member.user.id,
        username: member.user.username,
        name: member.user.first_name,
        resolvedFromArgs: true,
      };
    } catch {
      // User not in chat but ID is valid — return minimal info
      return {
        userId,
        username: undefined,
        name: String(userId),
        resolvedFromArgs: true,
      };
    }
  }

  logger.warn({ action: "resolveTarget", chatId, method: "unresolved", arg: args[0] });
  return null;
}
