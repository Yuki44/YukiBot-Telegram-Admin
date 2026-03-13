import { Bot, Context } from "grammy";
import { handleMessage } from "./handlers/message";

const token = process.env.BOT_TOKEN;
if (!token) throw new Error("BOT_TOKEN is not set in .env");

export const bot = new Bot<Context>(token);

bot.on("message", handleMessage);
