import { CommandContext } from "grammy";
import { BotContext } from "../../types";
import { chatRepository } from "../../db/repositories/chatRepository";
import { t } from "../../locales/i18n";
import { logger } from "../../utils/logger";

export async function wluaddHandler(ctx: CommandContext<BotContext>): Promise<void> {
  try {
    const chatId = ctx.chat.id;
    const logsTo = ctx.chatConfig?.logsTo;

    try {
      await ctx.deleteMessage();
    } catch {
      /* ignore */
    }

    const arg = ctx.match?.toString().trim();
    const userId = arg ? parseInt(arg, 10) : NaN;
    if (!userId || isNaN(userId) || !logsTo) return;

    try {
      await chatRepository.addSpamUserWhitelist(chatId, userId);
    } catch (err) {
      logger.error({ action: "wluadd", chatId, userId, error: String(err) });
      return;
    }

    await ctx.api.sendMessage(logsTo, t("spam.userAdded", { userId }), { parse_mode: "HTML" });
  } catch (err) {
    logger.error({ action: "wluadd", error: String(err) });
  }
}

export async function wludelHandler(ctx: CommandContext<BotContext>): Promise<void> {
  try {
    const chatId = ctx.chat.id;
    const logsTo = ctx.chatConfig?.logsTo;

    try {
      await ctx.deleteMessage();
    } catch {
      /* ignore */
    }

    const arg = ctx.match?.toString().trim();
    const userId = arg ? parseInt(arg, 10) : NaN;
    if (!userId || isNaN(userId) || !logsTo) return;

    try {
      await chatRepository.removeSpamUserWhitelist(chatId, userId);
    } catch (err) {
      logger.error({ action: "wludel", chatId, userId, error: String(err) });
      return;
    }

    await ctx.api.sendMessage(logsTo, t("spam.userRemoved", { userId }), { parse_mode: "HTML" });
  } catch (err) {
    logger.error({ action: "wludel", error: String(err) });
  }
}

export async function wlusHandler(ctx: CommandContext<BotContext>): Promise<void> {
  try {
    try {
      await ctx.deleteMessage();
    } catch {
      /* ignore */
    }

    const logsTo = ctx.chatConfig?.logsTo;
    if (!logsTo) return;

    const list: number[] = ctx.chatConfig?.spamUserWhitelist ?? [];
    const text =
      list.length === 0
        ? t("spam.usersEmpty")
        : `${t("spam.usersListHeader")}\n${list.map((id) => `• <a href="tg://user?id=${id}">${id}</a>`).join("\n")}`;

    await ctx.api.sendMessage(logsTo, text, { parse_mode: "HTML" });
  } catch (err) {
    logger.error({ action: "wlus", error: String(err) });
  }
}
