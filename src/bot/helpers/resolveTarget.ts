import { MessageEntity } from "grammy/types";
import { BotContext } from "../../types";
import { userRepository } from "../../db/repositories/userRepository";
import { adminRepository } from "../../db/repositories/adminRepository";

type TextMentionEntity = Extract<MessageEntity, { type: "text_mention" }>;

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
  const message = ctx.message;
  const chatId = ctx.chat!.id;

  // Priority 1: reply — full user object, zero API calls
  if (message?.reply_to_message?.from) {
    const u = message.reply_to_message.from;
    return {
      userId: u.id,
      username: u.username,
      name: u.first_name,
      resolvedFromArgs: false,
    };
  }

  if (!args[0]) return null;

  // Priority 2: text_mention entity (Telegram autocomplete) — full user object, zero API calls
  const mention = message?.entities?.find(
    (e): e is TextMentionEntity => e.type === "text_mention"
  );
  if (mention) {
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
    const cached = await userRepository.findByUsername(usernameWithoutAt, chatId);
    if (cached) {
      return {
        userId: cached.userId,
        username: cached.username,
        name: cached.name ?? String(cached.userId),
        resolvedFromArgs: true,
      };
    }

    // 3b: Admin collection fallback (admins may not be in User collection for older chats)
    const cachedAdmin = await adminRepository.findByUsername(usernameWithoutAt, chatId);
    if (cachedAdmin) {
      // Populate User collection for future lookups
      userRepository
        .findOrCreate(cachedAdmin.userId, chatId, cachedAdmin.username || undefined, cachedAdmin.name)
        .catch(() => {/* ignore */});
      return {
        userId: cachedAdmin.userId,
        username: cachedAdmin.username || undefined,
        name: cachedAdmin.name,
        resolvedFromArgs: true,
      };
    }

    // 3c: API fallback for users not yet in cache — may work if Telegram resolves the username
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const member = await ctx.api.getChatMember(chatId, args[0] as any);
      // Cache for future lookups
      userRepository
        .findOrCreate(member.user.id, chatId, member.user.username, member.user.first_name)
        .catch(() => {/* ignore */});
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

  // Priority 4: numeric userId — one API call, graceful fallback if user left
  if (/^\d+$/.test(args[0])) {
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
      // User not in chat but ID is valid — return minimal info
      return {
        userId,
        username: undefined,
        name: String(userId),
        resolvedFromArgs: true,
      };
    }
  }

  return null;
}
