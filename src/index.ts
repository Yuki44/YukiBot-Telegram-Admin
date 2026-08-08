import dotenv from "dotenv";
dotenv.config();

import { Server as HttpServer } from "http";
import { Bot } from "grammy";
import { autoRetry } from "@grammyjs/auto-retry";
import { BotContext } from "./types";
import { connectDB, disconnectDB } from "./db/connection";
import { createApiServer } from "./api/server";
import { PORT, BOT_ENABLED } from "./config";
import { loadChat } from "./bot/middleware/loadChat";
import { isAdmin } from "./bot/middleware/isAdmin";
import { adminOnlyCommands } from "./bot/middleware/adminOnlyCommands";
import { trackUser } from "./bot/middleware/trackUser";
import { trackTopic } from "./bot/middleware/trackTopic";
import { topicFiltering } from "./features/topicFiltering";
import { bannedWordsEnforcement } from "./features/bannedWordsEnforcement";
import { topicReminders } from "./features/topicReminders";
import { setupHandler } from "./bot/commands/setup";
import { migrarHandler } from "./bot/commands/migrar";
import { addTopicHandler } from "./bot/commands/addTopic";
import { editTopicHandler } from "./bot/commands/editTopic";
import { removeTopicHandler } from "./bot/commands/removeTopic";
import { toggleFeatureHandler } from "./bot/commands/toggleFeature";
import { avisarHandler, elAvisarHandler } from "./bot/commands/avisar";
import { quitarAvisoHandler } from "./bot/commands/quitaraviso";
import { avisosHandler } from "./bot/commands/avisos";
import { chatMemberHandler } from "./bot/handlers/chatMemberHandler";
import { newChatMembersHandler } from "./bot/handlers/newChatMembersHandler";
import { mediaForwardHandler } from "./bot/handlers/mediaForwardHandler";
import { quitarbanHandler } from "./bot/commands/perdonarban";
import { silHandler } from "./bot/commands/sil";
import { elsilHandler } from "./bot/commands/elsil";
import { silavHandler } from "./bot/commands/silav";
import { elsilavHandler } from "./bot/commands/elsilav";
import { qsilHandler } from "./bot/commands/qsil";
import { qsilavHandler } from "./bot/commands/qsilav";
import { comHandler } from "./bot/commands/com";
import { kkHandler } from "./bot/commands/kk";
import { bnHandler } from "./bot/commands/bn";
import { spamCallbackHandler } from "./bot/handlers/spamCallbackHandler";
import { csamCallbackHandler } from "./bot/handlers/csamCallbackHandler";
import { languageCallbackHandler } from "./bot/handlers/languageCallbackHandler";
import { startCsamScanner } from "./features/csamDetection/scanner";
import { startTopicSweep } from "./features/topicSync/sweep";
import { csamImageScan } from "./bot/handlers/csamImageHandler";
import { warmupOcr } from "./features/csamDetection/ocr";
import { csamBioTrigger } from "./bot/handlers/csamBioTrigger";
import { nameChangeTracker, trackIdentityFromTelegramUser } from "./bot/handlers/nameChangeTracker";
import { promoSpamDetection } from "./features/promoSpamDetection";
import { languageDetection } from "./features/languageDetection";
import { spamHandler } from "./bot/commands/spam";
import { nospamHandler } from "./bot/commands/nospam";
import { wladdHandler, wldelHandler, wlsHandler } from "./bot/commands/wlLinks";
import { wluaddHandler, wludelHandler, wlusHandler } from "./bot/commands/wlUsers";
import { topicRepository } from "./db/repositories/topicRepository";
import { chatRepository } from "./db/repositories/chatRepository";
import { logger } from "./utils/logger";

const token = process.env.BOT_TOKEN;
if (!token) throw new Error("BOT_TOKEN is not set in .env");

const bot = new Bot<BotContext>(token);

// Honor Telegram's flood-control (429 retry_after) on every API call. Without
// this, ~200 concurrent banChatMember calls during a join raid get rate-limited
// and the current handlers only log the failure — silently missing bans. Bounded
// so a hostile flood can't wedge the process.
bot.api.config.use(autoRetry({ maxRetryAttempts: 3, maxDelaySeconds: 30 }));

// Profile links (https://t.me/<handle>) render a preview card with a "SEND MESSAGE"
// button — a moderation notice must never invite the group to DM the target (G5).
bot.api.config.use(async (prev, method, payload, signal) => {
  if (method === "sendMessage" || method === "editMessageText") {
    return prev(
      method,
      {
        link_preview_options: { is_disabled: true },
        ...payload,
      } as typeof payload,
      signal
    );
  }
  return prev(method, payload, signal);
});

// Global error handler — prevents unhandled Grammy errors from crashing the process
bot.catch((err) => {
  logger.error({
    action: "bot.catch",
    error: String(err.error),
    ctx: err.ctx?.chat?.id ? `chat ${err.ctx.chat.id}` : "unknown",
  });
});

bot.use(loadChat);
bot.use(trackUser);
bot.use(trackTopic);
bot.use(isAdmin);
bot.use(adminOnlyCommands);

bot.command("setup", setupHandler);
bot.command("migrar", migrarHandler);
bot.command("addtopic", addTopicHandler);
bot.command("edittopic", editTopicHandler);
bot.command("removetopic", removeTopicHandler);
bot.command("togglefeature", toggleFeatureHandler);
bot.command("av", avisarHandler);
bot.command("elav", elAvisarHandler);
bot.command("qav", quitarAvisoHandler);
bot.command("avs", avisosHandler);
bot.command("qban", quitarbanHandler);
bot.command("sil", silHandler);
bot.command("elsil", elsilHandler);
bot.command("silav", silavHandler);
bot.command("elsilav", elsilavHandler);
bot.command("qsil", qsilHandler);
bot.command("qsilav", qsilavHandler);
bot.command("com", comHandler);
bot.command("kk", kkHandler);
bot.command("bn", bnHandler);

// Anti-spam commands
bot.command("spam", spamHandler);
bot.command("nospam", nospamHandler);
bot.command("wladd", wladdHandler);
bot.command("wldel", wldelHandler);
bot.command("wls", wlsHandler);
bot.command("wluadd", wluaddHandler);
bot.command("wludel", wludelHandler);
bot.command("wlus", wlusHandler);

bot.on("chat_member", chatMemberHandler);

// Second join trigger: the "X joined" service message. Reaches the bot even
// without admin rights and is the canonical signal for an *added* user, where
// `chat_member` alone would miss the welcome / auto-ban. Registered before the
// generic message middleware so a join service message isn't also run through
// spam/topic filters. handleUserJoin's short-window guard dedups the overlap.
bot.on("message:new_chat_members", newChatMembersHandler);

// Callback query router: CSAM alert buttons vs. spam ✅/❌ buttons (by data prefix)
bot.on("callback_query", async (ctx) => {
  if (ctx.chat && ctx.chat.type !== "private") {
    try {
      await trackIdentityFromTelegramUser(ctx, ctx.callbackQuery.from, ctx.chat.id, "callback_query");
    } catch (err) {
      logger.error({ action: "identity_callback_query", chatId: ctx.chat.id, error: String(err) });
    }
  }
  const data = ctx.callbackQuery.data ?? "";
  if (data.startsWith("csam_")) return await csamCallbackHandler(ctx);
  if (data.startsWith("langgrace_")) return await languageCallbackHandler(ctx);
  return await spamCallbackHandler(ctx);
});

bot.on("edited_message", async (ctx, next) => {
  const msg = ctx.editedMessage;
  if (msg && msg.chat.type !== "private") {
    try {
      await trackIdentityFromTelegramUser(ctx, msg.from, msg.chat.id, "edited_message");
    } catch (err) {
      logger.error({ action: "identity_edited_message", chatId: msg.chat.id, error: String(err) });
    }
  }
  return await next();
});

bot.on("message:forum_topic_created", async (ctx) => {
  const chatId = ctx.chat.id;
  const topicId = ctx.message.message_thread_id;
  const topicName = ctx.message.forum_topic_created?.name;
  if (chatId && topicId && topicName) {
    try {
      await topicRepository.upsertName(chatId, topicId, topicName);
    } catch {
      /* silent (G10) */
    }
  }
});

bot.on("message:forum_topic_edited", async (ctx) => {
  const chatId = ctx.chat.id;
  const topicId = ctx.message.message_thread_id;
  const topicName = (ctx.message as Record<string, unknown>)?.forum_topic_edited as
    | { name?: string }
    | undefined;
  if (chatId && topicId && topicName?.name) {
    try {
      await topicRepository.upsertName(chatId, topicId, topicName.name);
    } catch {
      /* silent (G10) */
    }
  }
});

// Record the message id + queue the bio check BEFORE the slow OCR, so a ban firing mid-OCR still finds it stored.
bot.on("message", csamBioTrigger);
bot.on("message", nameChangeTracker);
bot.on("message", csamImageScan);
bot.on("message", mediaForwardHandler);
bot.on("message", topicFiltering);
bot.on("message", bannedWordsEnforcement);
bot.on("message", promoSpamDetection);
bot.on("message", languageDetection);
bot.on("message", topicReminders);

let httpServer: HttpServer | null = null;

// Graceful shutdown
function shutdown(signal: string) {
  logger.info({ action: "shutdown", signal });
  bot.stop();
  if (httpServer) {
    httpServer.close((err) => {
      if (err) logger.error({ action: "shutdown_http", error: String(err) });
    });
  }
  disconnectDB()
    .catch((err) => logger.error({ action: "shutdown_db", error: String(err) }))
    .finally(() => process.exit(0));
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

async function start() {
  logger.info({ action: "startup", status: "connecting to DB..." });
  await connectDB();

  // Backfill Topic rows created before their fields existed. Idempotent.
  try {
    const result = await topicRepository.backfillIsUserConfigured();
    const allowed = await topicRepository.backfillAllowedMsgTypes();
    const granted = await topicRepository.backfillNewMsgTypes();
    if (result.configured > 0 || result.unconfigured > 0 || allowed > 0 || granted > 0) {
      logger.info({
        action: "startup.topic_backfill",
        ...result,
        allowedMsgTypes: allowed,
        newTypes: granted,
      });
    }
  } catch (err) {
    logger.error({ action: "startup.topic_backfill", error: String(err) });
  }

  // Junk rows from before trackTopic ignored non-forum chats, plus rows left
  // behind by chats the bot no longer serves.
  try {
    const forumChatIds = (await chatRepository.listAll())
      .filter((c) => c.type === "topics")
      .map((c) => c.chatId);
    const purged = await topicRepository.deleteOutsideChats(forumChatIds);
    if (purged > 0) logger.info({ action: "startup.topic_purge", purged });
  } catch (err) {
    logger.error({ action: "startup.topic_purge", error: String(err) });
  }

  const app = createApiServer(bot);
  httpServer = app.listen(PORT, () => {
    logger.info({ action: "api_server", status: `listening on port ${PORT}` });
  });

  if (!BOT_ENABLED) {
    logger.info({ action: "startup", status: "BOT_ENABLED=false — running API only, skipping bot polling" });
    return;
  }

  logger.info({ action: "startup", status: "starting bot polling..." });
  await bot.start({
    allowed_updates: ["message", "edited_message", "chat_member", "callback_query", "channel_post"],
    onStart: () => {
      logger.info({ action: "startup", status: "YukiBot is running" });
      // botInfo is populated by now — safe to boot the rolling CSAM bio scanner.
      startCsamScanner(bot);
      startTopicSweep(bot);
      warmupOcr();
    },
  });
}

start().catch((error) => {
  logger.error({ action: "startup", error: String(error) });
  process.exit(1);
});
