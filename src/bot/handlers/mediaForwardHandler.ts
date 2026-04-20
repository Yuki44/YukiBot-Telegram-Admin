import { BotContext } from "../../types";
import { NextFunction } from "grammy";
import { logger } from "../../utils/logger";

export async function mediaForwardHandler(ctx: BotContext, next: NextFunction): Promise<void> {
  await next();

  try {
    if (!ctx.chatConfig || !ctx.chatConfig.whitelist || !ctx.chatConfig.forwardsTo) return;
    if (!ctx.message) return;
    if (ctx.message.from?.is_bot === true) return;

    const isPhoto = !!ctx.message.photo;
    const isVideo = !!ctx.message.video;
    if (!isPhoto && !isVideo) return;

    const chatConfig = ctx.chatConfig;
    const forwardsTo = chatConfig.forwardsTo as number;

    let fileId: string;
    let mediaType: "photo" | "video";

    if (isPhoto) {
      const photos = ctx.message.photo!;
      fileId = photos[photos.length - 1].file_id;
      mediaType = "photo";
    } else {
      fileId = ctx.message.video!.file_id;
      mediaType = "video";
    }

    const originalCaption = ctx.message.caption || "";

    const now = new Date(new Date().toLocaleString("en-US", { timeZone: "Europe/Madrid" }));
    const days = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
    const dayName = days[now.getDay()];
    const day = String(now.getDate()).padStart(2, "0");
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const year = now.getFullYear();
    const dateStr = `${dayName} ${day}/${month}/${year}`;

    const displayName = ctx.message.from?.first_name || ctx.message.from?.username || "Usuario desconocido";

    const rawChatId = String(ctx.chat!.id).replace("-100", "");
    const messageLink = `t.me/c/${rawChatId}/${ctx.message.message_id}`;

    const lines = [
      ...(originalCaption ? [originalCaption, ""] : []),
      `📅 ${dateStr}`,
      `👤 ${displayName}`,
      `🔗 ${messageLink}`,
    ];
    const forwardedCaption = lines.join("\n").trim();

    if (mediaType === "photo") {
      await ctx.api.sendPhoto(forwardsTo, fileId, {
        caption: forwardedCaption,
      });
    } else {
      await ctx.api.sendVideo(forwardsTo, fileId, {
        caption: forwardedCaption,
      });
    }

    logger.info({
      action: "forward",
      mediaType,
      userId: ctx.message.from?.id,
      chatId: ctx.chat!.id,
      forwardsTo,
    });
  } catch (err) {
    logger.error({ action: "forward", error: String(err) });
  }
}
