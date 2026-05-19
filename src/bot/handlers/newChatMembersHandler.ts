import { Filter } from "grammy";
import { BotContext } from "../../types";
import { handleUserJoin } from "../helpers/handleJoin";
import { logger } from "../../utils/logger";

/**
 * Welcome / auto-ban on the `new_chat_members` service message.
 *
 * This is the second join trigger (see handleUserJoin's doc): it fires when a
 * user is *added* by someone — and, unlike `chat_member`, it reaches the bot
 * even without admin rights. handleUserJoin's short-window guard dedups against
 * the parallel `chat_member` update, so a single entry is greeted exactly once
 * (a later re-entry greets again). We deliberately do NOT emit an
 * ENTRADA_USUARIO log here — that
 * stays solely on the `chat_member` path (which carries inviter/invite-link
 * detail) to avoid a duplicate entry.
 */
export async function newChatMembersHandler(
  ctx: Filter<BotContext, "message:new_chat_members">
): Promise<void> {
  try {
    if (!ctx.chatConfig) return;

    const chatId = ctx.chat.id;
    const chatName = ctx.chat.title ?? "Unknown";

    for (const u of ctx.message.new_chat_members) {
      // Skip bots — including YukiBot itself being added to the group.
      if (u.is_bot) continue;

      await handleUserJoin(ctx.api, ctx.chatConfig, ctx.me.id, chatId, chatName, {
        id: u.id,
        username: u.username,
        name: u.first_name,
        fullName: [u.first_name, u.last_name].filter(Boolean).join(" "),
      });
    }
  } catch (err) {
    logger.error({ action: "newChatMembersHandler", error: String(err) });
  }
}
