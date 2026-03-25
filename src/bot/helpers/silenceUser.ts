import { BotContext } from "../../types";

export async function silenceUser(
  ctx: BotContext,
  targetUserId: number,
  chatId: number
): Promise<boolean> {
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
        until_date: Math.floor(Date.now() / 1000) + (7 * 24 * 60 * 60),
      }
    );

    // Double-check: verify the restriction actually applied
    const member = await ctx.api.getChatMember(chatId, targetUserId);
    if (member.status === "kicked") {
      // User is banned (more restrictive), treat as success
      console.log(`[SILENCE] user ${targetUserId} is banned in chat ${chatId}, treating as silenced`);
      return true;
    }
    if (member.status !== "restricted" || member.can_send_messages !== false) {
      console.error(`[SILENCE] verification failed for user ${targetUserId} in chat ${chatId}: status=${member.status}`);
      return false;
    }

    console.log(`[SILENCE] user ${targetUserId} silenced and verified in chat ${chatId}`);
    return true;
  } catch (err) {
    console.error(`[ERROR] failed to silence user ${targetUserId} in chat ${chatId}:`, err);
    return false;
  }
}
