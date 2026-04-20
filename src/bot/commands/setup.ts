import { CommandContext } from "grammy";
import { BotContext } from "../../types";
import { chatRepository } from "../../db/repositories/chatRepository";
import { adminRepository } from "../../db/repositories/adminRepository";
import { userRepository } from "../../db/repositories/userRepository";
import { logger } from "../../utils/logger";

export async function setupHandler(ctx: CommandContext<BotContext>) {
  try {
    const chatId = ctx.chat?.id;
    if (!chatId) return;

    const senderId = ctx.from?.id;
    if (!senderId) return;

    const author = await ctx.getChatMember(senderId);
    if (author.status !== "creator") {
      return;
    }

    const chat = await ctx.api.getChat(chatId);
    const chatType = "is_forum" in chat && chat.is_forum ? "topics" : "normal";

    const chatTitle = "title" in chat && chat.title ? chat.title : "Unknown";

    const features =
      chatType === "topics"
        ? {
            languageDetection: false,
            spamDetection: false,
            topicFiltering: false,
            commands: false,
            autoBan: false,
            autoWarnSpam: false,
          }
        : {
            languageDetection: false,
            spamDetection: false,
            commands: false,
            autoBan: false,
            autoWarnSpam: false,
          };

    await chatRepository.upsert({
      chatId,
      name: chatTitle,
      type: chatType,
      isActive: true,
      whitelist: false,
      features,
    });

    const admins = await ctx.api.getChatAdministrators(chatId);

    for (const admin of admins) {
      const fullName = [admin.user.first_name, admin.user.last_name].filter(Boolean).join(" ");

      await adminRepository.upsert({
        userId: admin.user.id,
        username: admin.user.username || "",
        name: fullName || "Unknown",
        chatId,
        chatName: chatTitle,
        role: admin.status === "creator" ? "owner" : "admin",
      });

      // Also populate User collection so @username lookups work
      await userRepository.findOrCreate(admin.user.id, chatId, admin.user.username, admin.user.first_name);
    }

    logger.info({
      action: "setup",
      userId: senderId,
      username: ctx.from?.username,
      chatId,
      chatType,
      adminCount: admins.length,
    });

    if (chatType === "topics") {
      await ctx.reply(
        "Chat initialized. Now use /addtopic <topicId> <allowedTypes> to register topics.\n" +
          "Example: /addtopic 12283 photo,video",
        { message_thread_id: ctx.message?.message_thread_id }
      );
    } else {
      await ctx.reply("Chat initialized successfully.", {
        message_thread_id: ctx.message?.message_thread_id,
      });
    }
  } catch (error) {
    logger.error({
      action: "setup",
      userId: ctx.from?.id,
      username: ctx.from?.username,
      chatId: ctx.chat?.id,
      error: String(error),
    });
    await ctx.reply("Setup failed, check logs.", {
      message_thread_id: ctx.message?.message_thread_id,
    });
  }
}
