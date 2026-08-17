import { Bot, InputFile } from "grammy";
import { BotContext, IBroadcastPost, IChannelBroadcast } from "../../types";
import { logger } from "../../utils/logger";

/**
 * Sends one invite-link post and returns its message_id. With no image we send a
 * plain text message so Telegram renders the native request-to-join preview; with
 * an image we send the photo instead, caption above it. The image slot is the
 * per-post switch. A photo can't itself be a hyperlink, so the channel's
 * call-to-action button (when enabled) is appended as an inline URL button.
 *
 * `previousMessageId` (this post's last send) is deleted after the new post lands,
 * so each post keeps only its own latest copy — order matters: a failed send leaves
 * the old one standing rather than emptying the channel.
 */
export async function sendBroadcastPost(
  bot: Bot<BotContext>,
  channelId: number,
  post: IBroadcastPost,
  button: IChannelBroadcast["button"],
  previousMessageId?: number | null
): Promise<number> {
  const body = post.caption ? `${post.caption}\n${post.url}` : post.url;
  const reply_markup =
    button.enabled && button.text.trim()
      ? { inline_keyboard: [[{ text: button.text, url: post.url }]] }
      : undefined;

  let sent;
  if (post.image) {
    sent = await bot.api.sendPhoto(channelId, new InputFile(post.image.data, post.image.filename), {
      caption: body,
      show_caption_above_media: true,
      reply_markup,
    });
  } else {
    sent = await bot.api.sendMessage(channelId, body, { reply_markup });
  }

  if (previousMessageId) {
    try {
      await bot.api.deleteMessage(channelId, previousMessageId);
    } catch (err) {
      logger.warn({ action: "broadcast.delete_previous", channelId, previousMessageId, error: String(err) });
    }
  }

  return sent.message_id;
}
