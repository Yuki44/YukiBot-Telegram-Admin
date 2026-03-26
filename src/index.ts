import dotenv from "dotenv";
dotenv.config();

import { Bot } from "grammy";
import { BotContext } from "./types";
import { connectDB } from "./db/connection";
import { loadChat } from "./bot/middleware/loadChat";
import { isAdmin } from "./bot/middleware/isAdmin";
import { adminOnlyCommands } from "./bot/middleware/adminOnlyCommands";
import { topicFiltering } from "./features/topicFiltering";
import { setupHandler } from "./bot/commands/setup";
import { addTopicHandler } from "./bot/commands/addTopic";
import { syncAdminsHandler } from "./bot/commands/syncAdmins";
import { editTopicHandler } from "./bot/commands/editTopic";
import { removeTopicHandler } from "./bot/commands/removeTopic";
import { toggleFeatureHandler } from "./bot/commands/toggleFeature";
import { avisarHandler, elAvisarHandler } from "./bot/commands/avisar";
import { quitarAvisoHandler } from "./bot/commands/quitaraviso";
import { avisosHandler } from "./bot/commands/avisos";
import { chatMemberHandler } from "./bot/handlers/chatMemberHandler";
import { perdonarbanHandler } from "./bot/commands/perdonarban";
import { silHandler } from "./bot/commands/sil";
import { elsilHandler } from "./bot/commands/elsil";
import { silavHandler } from "./bot/commands/silav";
import { elsilavHandler } from "./bot/commands/elsilav";
import { qsilHandler } from "./bot/commands/qsil";

const token = process.env.BOT_TOKEN;
if (!token) throw new Error("BOT_TOKEN is not set in .env");

const bot = new Bot<BotContext>(token);

// Register global middleware
bot.use(loadChat);
bot.use(isAdmin);
bot.use(adminOnlyCommands);

// Register commands
bot.command("setup", setupHandler);
bot.command("addtopic", addTopicHandler);
bot.command("syncadmins", syncAdminsHandler);
bot.command("edittopic", editTopicHandler);
bot.command("removetopic", removeTopicHandler);
bot.command("togglefeature", toggleFeatureHandler);
bot.command("av", avisarHandler);
bot.command("elav", elAvisarHandler);
bot.command("qav", quitarAvisoHandler);
bot.command("avs", avisosHandler);
bot.command("pban", perdonarbanHandler);
bot.command("sil", silHandler);
bot.command("elsil", elsilHandler);
bot.command("silav", silavHandler);
bot.command("elsilav", elsilavHandler);
bot.command("qsil", qsilHandler);

// Register chat_member handler
bot.on("chat_member", chatMemberHandler);

// Register message handler with topic filtering
bot.on("message", topicFiltering);

// Start bot
async function start() {
  await connectDB();
  await bot.start({
    allowed_updates: ["message", "chat_member", "callback_query"],
  });
  console.log("YukiBot is running...");
}

start().catch((error) => {
  console.error("Failed to start bot:", error);
  process.exit(1);
});
