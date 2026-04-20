import { BotContext } from "../../types";
import { logger } from "../../utils/logger";

export async function unsilenceUser(ctx: BotContext, targetUserId: number, chatId: number): Promise<boolean> {
  try {
    // Grant all permissions as true — Telegram will cap them at the group's global defaults.
    // This removes the per-user exception entry entirely, unlike mirroring the defaults explicitly.
    await ctx.api.restrictChatMember(chatId, targetUserId, {
      can_send_messages: true,
      can_send_audios: true,
      can_send_documents: true,
      can_send_photos: true,
      can_send_videos: true,
      can_send_video_notes: true,
      can_send_voice_notes: true,
      can_send_polls: true,
      can_send_other_messages: true,
      can_add_web_page_previews: true,
      can_change_info: true,
      can_invite_users: true,
      can_pin_messages: true,
    });

    logger.info({ action: "unsilence", userId: targetUserId, chatId });
    return true;
  } catch (err) {
    logger.error({ action: "unsilence", userId: targetUserId, chatId, error: String(err) });
    return false;
  }
}
