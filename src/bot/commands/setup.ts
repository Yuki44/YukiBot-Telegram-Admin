import { CommandContext } from "grammy";
import { BotContext } from "../../types";
import { chatRepository } from "../../db/repositories/chatRepository";
import { adminRepository } from "../../db/repositories/adminRepository";
import { logger } from "../../utils/logger";

export async function setupHandler(ctx: CommandContext<BotContext>) {
  try {
    const chatId = ctx.chat?.id;
    if (!chatId) return;

    // Check if sender is creator of the chat
    const senderId = ctx.from?.id;
    if (!senderId) return;

    const author = await ctx.getChatMember(senderId);
    if (author.status !== "creator") {
      // Ignore silently if not creator
      return;
    }

    // Fetch chat info
    const chat = await ctx.api.getChat(chatId);

    // Determine type
    const chatType = "is_forum" in chat && chat.is_forum ? "topics" : "normal";

    const chatTitle = ("title" in chat && chat.title) ? chat.title : "Unknown";

    // Upsert Chat document
    const features =
      chatType === "topics"
        ? {
            languageDetection: false,
            spamDetection: false,
            topicFiltering: false,
            commands: false,
          }
        : {
            languageDetection: false,
            spamDetection: false,
            commands: false,
          };

    await chatRepository.upsert({
      chatId,
      name: chatTitle,
      type: chatType,
      isActive: true,
      features,
    });

    // Fetch and upsert admins
    const admins = await ctx.api.getChatAdministrators(chatId);

    for (const admin of admins) {
      const fullName = [admin.user.first_name, admin.user.last_name]
        .filter(Boolean)
        .join(" ");

      await adminRepository.upsert({
        userId: admin.user.id,
        username: admin.user.username || "",
        name: fullName || "Unknown",
        chatId,
        chatName: chatTitle,
        role: admin.status === "creator" ? "owner" : "admin",
      });
    }

    logger.info({
      action: "setup",
      userId: senderId,
      username: ctx.from?.username,
      chatId,
      chatType,
      adminCount: admins.length,
    });

    // Send appropriate confirmation message
    if (chatType === "topics") {
      await ctx.reply(
        "Chat initialized. Now use /addtopic <topicId> <allowedTypes> to register topics.\n" +
          "Example: /addtopic 12283 photo,video"
      );
    } else {
      await ctx.reply("Chat initialized successfully.");
    }
  } catch (error) {
    logger.error({
      action: "setup",
      userId: ctx.from?.id,
      username: ctx.from?.username,
      chatId: ctx.chat?.id,
      error: String(error),
    });
    await ctx.reply("Setup failed, check logs.");
  }
}
