import { Router, Request, Response } from "express";
import { Bot } from "grammy";
import { BotContext } from "../../types";
import { logger } from "../../utils/logger";

/**
 * Public-by-file_id avatar proxy. Telegram's bot file URLs include the bot token
 * (https://api.telegram.org/file/bot<token>/<path>), so we MUST proxy rather than
 * redirect. file_ids themselves are long opaque strings only obtainable through
 * authenticated dashboard endpoints, which is the access-control surface we lean on.
 *
 * Each request resolves the file_id to a fresh download URL via getFile (the URLs
 * expire after ~1h but file_ids are stable), streams the bytes back to the client,
 * and emits a 1h browser cache header so the avatar doesn't refetch on every render.
 */
export function createPhotosRouter(bot: Bot<BotContext>): Router {
  const router = Router();

  router.get("/:fileId", async (req: Request, res: Response) => {
    const fileId = req.params.fileId;
    if (!fileId || fileId.length > 200) {
      res.status(400).json({ error: "invalid_file_id" });
      return;
    }

    try {
      const file = await bot.api.getFile(fileId);
      if (!file.file_path) {
        res.status(404).json({ error: "file_not_available" });
        return;
      }

      const url = `https://api.telegram.org/file/bot${bot.token}/${file.file_path}`;
      const upstream = await fetch(url);
      if (!upstream.ok || !upstream.body) {
        res.status(upstream.status === 404 ? 404 : 502).json({ error: "upstream_failed" });
        return;
      }

      const ct = upstream.headers.get("content-type") ?? "image/jpeg";
      res.setHeader("Content-Type", ct);
      res.setHeader("Cache-Control", "public, max-age=3600, immutable");

      // Pipe upstream → response. Node 18+ Fetch returns a web ReadableStream — convert
      // to a Node stream via Readable.fromWeb.
      const { Readable } = await import("stream");
      Readable.fromWeb(upstream.body as never).pipe(res);
    } catch (err) {
      const msg = String(err);
      // Telegram returns 400 "wrong file_id or the file is temporarily unavailable"
      // when a cached photoFileId has aged out. The avatar fallback in the UI handles
      // it cleanly — no operator action needed, so we skip the WARN noise.
      const isStaleFileId =
        msg.includes("wrong file_id") || msg.includes("file is temporarily unavailable");
      if (!isStaleFileId) {
        logger.warn({ action: "photos.proxy", error: msg, fileId });
      }
      res.status(404).json({ error: "not_found" });
    }
  });

  return router;
}
