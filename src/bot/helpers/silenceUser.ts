import { BotContext } from "../../types";
import { logger } from "../../utils/logger";
import { SILENCE_DURATION_S } from "../../config/constants";

export async function silenceUser(ctx: BotContext, targetUserId: number, chatId: number): Promise<boolean> {
  try {
    await ctx.api.restrictChatMember(
      chatId,
      targetUserId,
      {
        can_send_messages: false,
        can_send_audios: false,
        can_send_documents: false,
        can_send_photos: false,
        can_send_videos: false,
        can_send_video_notes: false,
        can_send_voice_notes: false,
        can_send_polls: false,
        can_send_other_messages: false,
        can_add_web_page_previews: false,
        can_change_info: false,
        can_invite_users: false,
        can_pin_messages: false,
      },
      {
        until_date: Math.floor(Date.now() / 1000) + SILENCE_DURATION_S,
      }
    );

    // Double-check: verify the restriction actually applied
    const member = await ctx.api.getChatMember(chatId, targetUserId);
    if (member.status === "kicked") {
      // User is banned (more restrictive), treat as success
      logger.info({ action: "silence", userId: targetUserId, chatId, note: "already_banned" });
      return true;
    }
    if (member.status !== "restricted" || member.can_send_messages !== false) {
      logger.error({ action: "silence_verify", userId: targetUserId, chatId, status: member.status });
      return false;
    }

    logger.info({ action: "silence", userId: targetUserId, chatId });
    return true;
  } catch (err) {
    logger.error({ action: "silence", userId: targetUserId, chatId, error: String(err) });
    return false;
  }
}
