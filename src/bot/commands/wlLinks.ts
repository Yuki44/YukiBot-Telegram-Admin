import { CommandContext } from "grammy";
import { BotContext } from "../../types";
import { chatRepository } from "../../db/repositories/chatRepository";
import { t } from "../../locales/i18n";
import { logger } from "../../utils/logger";

function parseDomain(input: string): string | null {
  const trimmed = input
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split("/")[0];
  if (!trimmed || trimmed.length < 3) return null;
  return trimmed;
}

export async function wladdHandler(ctx: CommandContext<BotContext>): Promise<void> {
  try {
    const chatId = ctx.chat.id;
    const domain = parseDomain(ctx.match?.toString() ?? "");

    try {
      await ctx.deleteMessage();
    } catch {
      /* ignore */
    }

    if (!domain || !ctx.chatConfig?.logsTo) return;

    try {
      await chatRepository.addLinkWhitelist(chatId, domain);
    } catch (err) {
      logger.error({ action: "wladd", chatId, domain, error: String(err) });
      return;
    }

    await ctx.api.sendMessage(ctx.chatConfig.logsTo, t("spam.domainAdded", { domain }), {
      parse_mode: "HTML",
    });
  } catch (err) {
    logger.error({ action: "wladd", error: String(err) });
  }
}

export async function wldelHandler(ctx: CommandContext<BotContext>): Promise<void> {
  try {
    const chatId = ctx.chat.id;
    const domain = parseDomain(ctx.match?.toString() ?? "");

    try {
      await ctx.deleteMessage();
    } catch {
      /* ignore */
    }

    if (!domain || !ctx.chatConfig?.logsTo) return;

    try {
      await chatRepository.removeLinkWhitelist(chatId, domain);
    } catch (err) {
      logger.error({ action: "wldel", chatId, domain, error: String(err) });
      return;
    }

    await ctx.api.sendMessage(ctx.chatConfig.logsTo, t("spam.domainRemoved", { domain }), {
      parse_mode: "HTML",
    });
  } catch (err) {
    logger.error({ action: "wldel", error: String(err) });
  }
}

export async function wlsHandler(ctx: CommandContext<BotContext>): Promise<void> {
  try {
    try {
      await ctx.deleteMessage();
    } catch {
      /* ignore */
    }

    const logsTo = ctx.chatConfig?.logsTo;
    if (!logsTo) return;

    const list: string[] = ctx.chatConfig?.linkWhitelist ?? [];
    const text =
      list.length === 0
        ? t("spam.domainsEmpty")
        : `${t("spam.domainsListHeader")}\n${list.map((d) => `• <code>${d}</code>`).join("\n")}`;

    await ctx.api.sendMessage(logsTo, text, { parse_mode: "HTML" });
  } catch (err) {
    logger.error({ action: "wls", error: String(err) });
  }
}
