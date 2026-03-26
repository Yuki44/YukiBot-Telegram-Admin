import { BotContext } from "../../types";

export async function unsilenceUser(
  ctx: BotContext,
  targetUserId: number,
  chatId: number
): Promise<boolean> {
  try {
    // Fetch the chat's own default permissions so we don't grant more than the chat allows
    const chat = await ctx.api.getChat(chatId);
    const defaults = chat.permissions ?? {};

    await ctx.api.restrictChatMember(chatId, targetUserId, {
      can_send_messages: defaults.can_send_messages ?? false,
      can_send_audios: defaults.can_send_audios ?? false,
      can_send_documents: defaults.can_send_documents ?? false,
      can_send_photos: defaults.can_send_photos ?? false,
      can_send_videos: defaults.can_send_videos ?? false,
      can_send_video_notes: defaults.can_send_video_notes ?? false,
      can_send_voice_notes: defaults.can_send_voice_notes ?? false,
      can_send_polls: defaults.can_send_polls ?? false,
      can_send_other_messages: defaults.can_send_other_messages ?? false,
      can_add_web_page_previews: defaults.can_add_web_page_previews ?? false,
      can_change_info: defaults.can_change_info ?? false,
      can_invite_users: defaults.can_invite_users ?? false,
      can_pin_messages: defaults.can_pin_messages ?? false,
    });

    console.log(`[UNSILENCE] user ${targetUserId} unsilenced in chat ${chatId}`);
    return true;
  } catch (err) {
    console.error(`[ERROR] failed to unsilence user ${targetUserId} in chat ${chatId}:`, err);
    return false;
  }
}
