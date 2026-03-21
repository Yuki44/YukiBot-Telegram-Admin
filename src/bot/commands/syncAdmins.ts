import { CommandContext } from "grammy";
import { BotContext } from "../../types";
import { Admin } from "../../db/models/Admin";
import { logger } from "../../utils/logger";

export async function syncAdminsHandler(ctx: CommandContext<BotContext>) {
  try {
    const chatId = ctx.chat?.id;
    if (!chatId) return;

    // Check if sender is admin
    if (!ctx.isAdmin) {
      return;
    }

    // Fetch fresh admin list from Telegram
    const admins = await ctx.api.getChatAdministrators(chatId);

    // Upsert each admin
    for (const admin of admins) {
      const fullName = [admin.user.first_name, admin.user.last_name]
        .filter(Boolean)
        .join(" ");

      await Admin.findOneAndUpdate(
        { userId: admin.user.id, chatId },
        {
          $set: {
            userId: admin.user.id,
            username: admin.user.username || "",
            name: fullName || "Unknown",
            chatId,
            role: admin.status === "creator" ? "owner" : "admin",
          },
        },
        { upsert: true, new: true }
      );
    }

    logger.info({
      action: "syncAdmins",
      userId: ctx.from?.id,
      username: ctx.from?.username,
      chatId,
      adminCount: admins.length,
    });

    await ctx.reply(`Admins synced. Total: ${admins.length}`);
  } catch (error) {
    logger.error({
      action: "syncAdmins",
      userId: ctx.from?.id,
      username: ctx.from?.username,
      chatId: ctx.chat?.id,
      error: String(error),
    });
    await ctx.reply("Failed to sync admins, check logs.");
  }
}
