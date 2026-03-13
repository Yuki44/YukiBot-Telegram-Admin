import dotenv from "dotenv";
dotenv.config();

import { bot } from "./bot";
import { BOT_ENABLED } from "./config";

bot.start();
console.log(`YukiBot is running... [Mode: ${BOT_ENABLED ? "ACTIVE" : "DRY-RUN"}]`);
