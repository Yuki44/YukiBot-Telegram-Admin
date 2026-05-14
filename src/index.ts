import dotenv from "dotenv";
dotenv.config();

import { Server as HttpServer } from "http";
import { Bot } from "grammy";
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
import { setupHandler } from "./bot/commands/setup";
import { addTopicHandler } from "./bot/commands/addTopic";
import { editTopicHandler } from "./bot/commands/editTopic";
import { removeTopicHandler } from "./bot/commands/removeTopic";
import { toggleFeatureHandler } from "./bot/commands/toggleFeature";
import { avisarHandler, elAvisarHandler } from "./bot/commands/avisar";
import { quitarAvisoHandler } from "./bot/commands/quitaraviso";
import { avisosHandler } from "./bot/commands/avisos";
import { chatMemberHandler } from "./bot/handlers/chatMemberHandler";
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
import { promoSpamDetection } from "./features/promoSpamDetection";
import { spamHandler } from "./bot/commands/spam";
import { nospamHandler } from "./bot/commands/nospam";
import { wladdHandler, wldelHandler, wlsHandler } from "./bot/commands/wlLinks";
import { wluaddHandler, wludelHandler, wlusHandler } from "./bot/commands/wlUsers";
import { topicRepository } from "./db/repositories/topicRepository";
import { logger } from "./utils/logger";

const token = process.env.BOT_TOKEN;
if (!token) throw new Error("BOT_TOKEN is not set in .env");

const bot = new Bot<BotContext>(token);

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

// Callback query handler for spam ✅/❌ inline buttons
bot.on("callback_query", spamCallbackHandler);

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

bot.on("message", mediaForwardHandler);
bot.on("message", topicFiltering);
bot.on("message", bannedWordsEnforcement);
bot.on("message", promoSpamDetection);

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
    allowed_updates: ["message", "chat_member", "callback_query", "channel_post"],
    onStart: () => logger.info({ action: "startup", status: "YukiBot is running" }),
  });
}

start().catch((error) => {
  logger.error({ action: "startup", error: String(error) });
  process.exit(1);
});
