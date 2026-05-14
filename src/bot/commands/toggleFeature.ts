import { CommandContext } from "grammy";
import { BotContext } from "../../types";
import { adminRepository } from "../../db/repositories/adminRepository";
import { chatRepository } from "../../db/repositories/chatRepository";
import { logger } from "../../utils/logger";

const VALID_FEATURES = [
  "languageDetection",
  "topicFiltering",
  "autoBan",
  "autoWarnSpam",
  "promoSpamDetection",
  "bannedWordsEnforcement",
] as const;

type FeatureName = (typeof VALID_FEATURES)[number];

export async function toggleFeatureHandler(ctx: CommandContext<BotContext>) {
  try {
    const chatId = ctx.chat?.id;
    const userId = ctx.from?.id;
    if (!chatId || !userId) return;

    if (!ctx.chatConfig) return;

    const isOwner = await adminRepository.isOwner(userId, chatId);
    if (!isOwner) return;

    const featureName = ctx.match?.toString().trim();

    if (!featureName || !VALID_FEATURES.includes(featureName as FeatureName)) {
      await ctx.reply(
        "Valid features: languageDetection, topicFiltering, autoBan, autoWarnSpam, promoSpamDetection, bannedWordsEnforcement"
      );
      return;
    }

    const key = featureName as FeatureName;
    const currentValue = ctx.chatConfig.features[key];
    const newValue = !currentValue;

    const updatedFeatures = { ...ctx.chatConfig.features, [key]: newValue };
    await chatRepository.updateFeatures(chatId, updatedFeatures);

    logger.info({
      action: "toggleFeature",
      userId,
      username: ctx.from?.username,
      chatId,
      feature: featureName,
      enabled: newValue,
    });

    await ctx.reply(`Feature ${featureName} is now ${newValue ? "enabled" : "disabled"}.`);
  } catch (error) {
    logger.error({
      action: "toggleFeature",
      userId: ctx.from?.id,
      username: ctx.from?.username,
      chatId: ctx.chat?.id,
      error: String(error),
    });
    await ctx.reply("Failed to toggle feature, check logs.");
  }
}
