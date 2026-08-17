import { Bot, InputFile } from "grammy";
import { BotContext, IBroadcastPost, IChannelBroadcast } from "../../types";

/**
 * Sends one invite-link post. With no image we send a plain text message so
 * Telegram renders the native request-to-join preview; with an image we send the
 * photo instead, caption above it. The image slot is the per-post switch. A photo
 * can't itself be a hyperlink, so the channel's call-to-action button (when enabled)
 * is appended as an inline URL button.
 */
export async function sendBroadcastPost(
  bot: Bot<BotContext>,
  channelId: number,
  post: IBroadcastPost,
  button: IChannelBroadcast["button"]
): Promise<void> {
  const body = post.caption ? `${post.caption}\n${post.url}` : post.url;
  const reply_markup =
    button.enabled && button.text.trim()
      ? { inline_keyboard: [[{ text: button.text, url: post.url }]] }
      : undefined;

  if (post.image) {
    await bot.api.sendPhoto(channelId, new InputFile(post.image.data, post.image.filename), {
      caption: body,
      show_caption_above_media: true,
      reply_markup,
    });
  } else {
    await bot.api.sendMessage(channelId, body, { reply_markup });
  }
}
