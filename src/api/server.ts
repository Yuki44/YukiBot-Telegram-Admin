import express, { Express, Request, Response, NextFunction } from "express";
import cors from "cors";
import path from "path";
import { Bot } from "grammy";
import { BotContext } from "../types";
import { logger } from "../utils/logger";
import { createAuthRouter } from "./routes/auth";
import { createChatsRouter } from "./routes/chats";
import { createTopicsRouter } from "./routes/topics";
import { createUsersRouter } from "./routes/users";
import { createWhitelistRouter } from "./routes/whitelist";
import { createBannedWordsRouter } from "./routes/bannedWords";
import { createActivityLogsRouter } from "./routes/activityLogs";
import { createAdminsRouter } from "./routes/admins";
import { createPhotosRouter } from "./routes/photos";
import { BOT_LOGIN_DOMAIN, BOT_USERNAME } from "../config";

const WEB_DIST = path.join(__dirname, "..", "..", "web", "dist");

export function createApiServer(bot: Bot<BotContext>): Express {
  const app = express();

  app.use(cors());
  app.use(express.json({ limit: "100kb" }));

  app.get("/health", (_req: Request, res: Response) => {
    res.json({ ok: true });
  });

  // Public config — read at runtime by the SPA so we don't need build-time env vars.
  app.get("/api/public/config", (_req: Request, res: Response) => {
    res.json({ botUsername: BOT_USERNAME, botLoginDomain: BOT_LOGIN_DOMAIN });
  });

  app.use("/api/auth", createAuthRouter());
  app.use("/api/chats", createChatsRouter());
  app.use("/api/chats/:chatId/topics", createTopicsRouter());
  app.use("/api/chats/:chatId/users", createUsersRouter(bot));
  app.use("/api/chats/:chatId/whitelist", createWhitelistRouter());
  app.use("/api/chats/:chatId/banned-words", createBannedWordsRouter());
  app.use("/api/chats/:chatId/logs", createActivityLogsRouter());
  app.use("/api/chats/:chatId/admins", createAdminsRouter());
  app.use("/api/photos", createPhotosRouter(bot));

  app.use(express.static(WEB_DIST));

  // SPA fallback — serve index.html for any non-/api, non-/health path so React Router handles it.
  app.get(/^\/(?!api\/|health$).*/, (_req: Request, res: Response, next: NextFunction) => {
    res.sendFile(path.join(WEB_DIST, "index.html"), (err) => {
      if (err) next(err);
    });
  });

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    logger.error({ action: "api.error", error: String(err) });
    res.status(500).json({ error: "internal_error" });
  });

  return app;
}
