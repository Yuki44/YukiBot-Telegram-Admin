import { CommandContext } from "grammy";
import { BotContext } from "../../types";
import { chatRepository } from "../../db/repositories/chatRepository";
import { adminRepository } from "../../db/repositories/adminRepository";
import { userRepository } from "../../db/repositories/userRepository";
import { discoverProfilePhoto } from "../helpers/profilePhoto";
import { logger } from "../../utils/logger";
import { t } from "../../locales/i18n";

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

    // Idempotent: first run initializes every field (all off except isActive);
    // re-runs only re-sync name/type and backfill fields that are still missing,
    // never resetting an owner-enabled feature/whitelist.
    await chatRepository.ensureInitialized(chatId, { name: chatTitle, type: chatType });

    const admins = await ctx.api.getChatAdministrators(chatId);

    // Filter Telegram's GroupAnonymousBot (id 1087968824) and other bots — they show up in
    // getChatAdministrators when the chat has "anonymous admins" enabled but they don't
    // represent a real person and would render as blank rows in the dashboard.
    const ANON_ADMIN_BOT_ID = 1087968824;
    const realAdmins = admins.filter((a) => !a.user.is_bot && a.user.id !== ANON_ADMIN_BOT_ID);

    for (const admin of realAdmins) {
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

      // Pre-fetch the profile photo so admins who've never messaged in the group
      // still render an avatar in the dashboard's Admins screen (issue #5).
      // Fire-and-forget: photo discovery is best-effort and logs failures internally.
      void discoverProfilePhoto(ctx.api, admin.user.id, chatId);
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
      await ctx.reply(t("setup.initializedTopics"), {
        message_thread_id: ctx.message?.message_thread_id,
      });
    } else {
      await ctx.reply(t("setup.initialized"), {
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
    await ctx.reply(t("setup.failed"), {
      message_thread_id: ctx.message?.message_thread_id,
    });
  }
}
