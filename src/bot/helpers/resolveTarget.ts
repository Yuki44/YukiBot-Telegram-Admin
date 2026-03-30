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

  console.log(`[resolveTarget] Resolving target in chat ${chatId}. Args:`, args);

  // Check if args[0] is a potential target BEFORE checking for reply_to_message.
  // This avoids accidental self-targets or misidentifications when a reply exists but isn't the intended target.
  const hasTargetInArgs = args[0] && (
    args[0].startsWith("@") ||        // Mention or username
    /^\d+$/.test(args[0]) ||          // Numeric user ID
    message?.entities?.some(e => e.type === "text_mention" && (e.offset === 0 || (message.text || message.caption || "").substring(0, e.offset).trim() === ""))
  );

  // Priority 1: If an explicit target is in the arguments, it OVERRIDES the reply
  if (hasTargetInArgs) {
    console.log(`[resolveTarget] Explicit target found in args[0]: ${args[0]}. Skipping reply check.`);
  } else if (message?.reply_to_message?.from) {
    // Priority 2: reply — only if NO target in args
    const u = message.reply_to_message.from;
    console.log(`[resolveTarget] Resolved from reply: ${u.id} (${u.username || 'no username'})`);
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
    console.log(`[resolveTarget] Resolved from text_mention: ${mention.user.id} (${mention.user.username || 'no username'})`);
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
    console.log(`[resolveTarget] Attempting resolution for username: ${usernameWithoutAt}`);

    // 3a: DB cache (populated by trackUser middleware) — zero API calls
    const cached = await userRepository.findByUsername(usernameWithoutAt, Number(chatId));
    if (cached) {
      console.log(`[resolveTarget] Resolved from User DB cache: ${cached.userId}`);
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
      console.log(`[resolveTarget] Resolved from Admin DB cache: ${cachedAdmin.userId}`);
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

    console.log(`[resolveTarget] Username ${usernameWithoutAt} not found in cache.`);
    // 3c: API fallback for users not yet in cache
    return null;
  }

  // Priority 4: numeric userId — one API call, graceful fallback if user left
  if (/^\d+$/.test(args[0])) {
    const userId = parseInt(args[0], 10);
    console.log(`[resolveTarget] Attempting resolution for numeric ID: ${userId}`);
    try {
      const member = await ctx.api.getChatMember(Number(chatId), userId);
      console.log(`[resolveTarget] Resolved via getChatMember: ${member.user.id} (${member.user.username || 'no username'})`);
      return {
        userId: member.user.id,
        username: member.user.username,
        name: member.user.first_name,
        resolvedFromArgs: true,
      };
    } catch (e) {
      console.log(`[resolveTarget] getChatMember failed for ${userId}, returning minimal info. Error:`, e);
      // User not in chat but ID is valid — return minimal info
      return {
        userId,
        username: undefined,
        name: String(userId),
        resolvedFromArgs: true,
      };
    }
  }

  console.log(`[resolveTarget] Could not resolve target for args[0]: ${args[0]}`);
  return null;
}
