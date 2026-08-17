import express, { Router, Request, Response, NextFunction } from "express";
import { Bot } from "grammy";
import { BotContext, IChannelBroadcast } from "../../types";
import { authenticate } from "../middleware/authenticate";
import { channelBroadcastRepository } from "../../db/repositories/channelBroadcastRepository";
import { broadcastNow } from "../../bot/scheduler/broadcastScheduler";
import { nextPost } from "../../bot/scheduler/broadcastDefaults";
import { logger } from "../../utils/logger";

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
const META_TTL_MS = 24 * 60 * 60 * 1000;

function requireSuperAdmin(req: Request, res: Response, next: NextFunction): void {
  if (!req.user?.isSuperAdmin) {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  next();
}

function imageUrl(channelId: number, index: number): string {
  return `/api/channel-broadcasts/${channelId}/posts/${index}/image`;
}

/** Fire-and-forget refresh of the channel's title + photo from Telegram (like chats). */
function refreshChannelMeta(bot: Bot<BotContext>, cfg: IChannelBroadcast): void {
  const fresh = cfg.photoCheckedAt && Date.now() - cfg.photoCheckedAt.getTime() < META_TTL_MS;
  if (fresh && cfg.channelName) return;
  bot.api
    .getChat(cfg.channelId)
    .then((info) => {
      const title = "title" in info && info.title ? info.title : cfg.channelName;
      const photo = (info as { photo?: { small_file_id?: string } }).photo;
      return channelBroadcastRepository.setChannelMeta(cfg.channelId, {
        channelName: title,
        photoFileId: photo?.small_file_id ?? null,
      });
    })
    .catch((err) => {
      logger.warn({ action: "channelBroadcasts.refreshMeta", channelId: cfg.channelId, error: String(err) });
    });
}

function toDto(cfg: IChannelBroadcast) {
  const next = nextPost(cfg.posts, new Date());
  return {
    channelId: cfg.channelId,
    channelName: cfg.channelName,
    photoFileId: cfg.photoFileId ?? null,
    button: { enabled: cfg.button?.enabled ?? true, text: cfg.button?.text ?? "" },
    nextKey: next?.key ?? null,
    nextLabel: next?.label ?? null,
    nextAt: next?.at ?? null,
    posts: cfg.posts.map((p, i) => ({
      key: p.key,
      label: p.label,
      caption: p.caption,
      url: p.url,
      enabled: p.enabled,
      hours: p.hours,
      image: p.image
        ? { filename: p.image.filename, contentType: p.image.contentType, url: imageUrl(cfg.channelId, i) }
        : null,
    })),
  };
}

export function createChannelBroadcastsRouter(bot: Bot<BotContext>): Router {
  const router = Router();

  // Public image proxy for the dashboard thumbnail (an <img> can't send an auth
  // header). Registered before the auth guard. Invite banners aren't sensitive.
  router.get("/:channelId/posts/:index/image", async (req: Request, res: Response) => {
    try {
      const cfg = await channelBroadcastRepository.findByChannelId(Number(req.params.channelId));
      const image = cfg?.posts[Number(req.params.index)]?.image;
      if (!image) {
        res.status(404).json({ error: "not_found" });
        return;
      }
      res.setHeader("Content-Type", image.contentType);
      res.setHeader("Cache-Control", "private, max-age=60");
      res.send(image.data);
    } catch (err) {
      logger.error({ action: "channelBroadcasts.image", error: String(err) });
      res.status(500).json({ error: "internal_error" });
    }
  });

  router.use(authenticate);
  router.use(requireSuperAdmin);

  router.get("/", async (_req: Request, res: Response) => {
    try {
      const configs = await channelBroadcastRepository.listAll();
      for (const cfg of configs) refreshChannelMeta(bot, cfg);
      res.json(configs.map(toDto));
    } catch (err) {
      logger.error({ action: "channelBroadcasts.list", error: String(err) });
      res.status(500).json({ error: "internal_error" });
    }
  });

  router.get("/:channelId", async (req: Request, res: Response) => {
    try {
      const channelId = Number(req.params.channelId);
      const existing = await channelBroadcastRepository.findByChannelId(channelId);
      if (!existing) {
        res.status(404).json({ error: "not_found" });
        return;
      }
      // Normalize to the two canonical posts (also migrates pre-redesign docs).
      const cfg = await channelBroadcastRepository.ensureInitialized(channelId);
      refreshChannelMeta(bot, cfg);
      res.json(toDto(cfg));
    } catch (err) {
      logger.error({ action: "channelBroadcasts.get", error: String(err) });
      res.status(500).json({ error: "internal_error" });
    }
  });

  router.put("/:channelId/button", async (req: Request, res: Response) => {
    const channelId = Number(req.params.channelId);
    const body = (req.body ?? {}) as Record<string, unknown>;
    const enabled = typeof body.enabled === "boolean" ? body.enabled : true;
    const text = (typeof body.text === "string" ? body.text : "").trim().slice(0, 64);
    if (enabled && text === "") {
      res.status(400).json({ error: "button_text_required" });
      return;
    }
    try {
      const cfg = await channelBroadcastRepository.setButton(channelId, { enabled, text });
      if (!cfg) {
        res.status(404).json({ error: "not_found" });
        return;
      }
      res.json(toDto(cfg));
    } catch (err) {
      logger.error({ action: "channelBroadcasts.setButton", error: String(err) });
      res.status(500).json({ error: "internal_error" });
    }
  });

  router.put("/:channelId/posts/:index", async (req: Request, res: Response) => {
    const channelId = Number(req.params.channelId);
    const index = Number(req.params.index);
    const body = (req.body ?? {}) as Record<string, unknown>;
    const patch: Record<string, unknown> = {};
    if (typeof body.caption === "string") patch.caption = body.caption;
    if (typeof body.url === "string") {
      const url = body.url.trim();
      if (url === "" || /^https?:\/\//.test(url)) patch.url = url;
    }
    if (typeof body.enabled === "boolean") patch.enabled = body.enabled;

    try {
      const cfg = await channelBroadcastRepository.updatePost(channelId, index, patch);
      if (!cfg) {
        res.status(404).json({ error: "not_found" });
        return;
      }
      res.json(toDto(cfg));
    } catch (err) {
      logger.error({ action: "channelBroadcasts.updatePost", error: String(err) });
      res.status(500).json({ error: "internal_error" });
    }
  });

  router.put(
    "/:channelId/posts/:index/image",
    express.raw({ type: () => true, limit: MAX_IMAGE_BYTES }),
    async (req: Request, res: Response) => {
      const channelId = Number(req.params.channelId);
      const index = Number(req.params.index);
      const contentType = (req.headers["content-type"] ?? "").split(";")[0].trim();
      const filename = String(req.headers["x-filename"] ?? "image").slice(0, 128);
      const data = req.body as Buffer;

      if (!ALLOWED_IMAGE_TYPES.includes(contentType)) {
        res.status(400).json({ error: "invalid_image_type" });
        return;
      }
      if (!Buffer.isBuffer(data) || data.length === 0) {
        res.status(400).json({ error: "empty_image" });
        return;
      }

      try {
        const cfg = await channelBroadcastRepository.setImage(channelId, index, { data, filename, contentType });
        if (!cfg) {
          res.status(404).json({ error: "not_found" });
          return;
        }
        res.json(toDto(cfg));
      } catch (err) {
        logger.error({ action: "channelBroadcasts.setImage", error: String(err) });
        res.status(500).json({ error: "internal_error" });
      }
    }
  );

  router.delete("/:channelId/posts/:index/image", async (req: Request, res: Response) => {
    try {
      const cfg = await channelBroadcastRepository.setImage(
        Number(req.params.channelId),
        Number(req.params.index),
        null
      );
      if (!cfg) {
        res.status(404).json({ error: "not_found" });
        return;
      }
      res.json(toDto(cfg));
    } catch (err) {
      logger.error({ action: "channelBroadcasts.removeImage", error: String(err) });
      res.status(500).json({ error: "internal_error" });
    }
  });

  router.post("/:channelId/send-now", async (req: Request, res: Response) => {
    const channelId = Number(req.params.channelId);
    try {
      await broadcastNow(bot, channelId);
      const cfg = await channelBroadcastRepository.findByChannelId(channelId);
      logger.info({ action: "channelBroadcasts.sendNow", channelId, userId: req.user!.userId });
      res.json(cfg ? toDto(cfg) : { ok: true });
    } catch (err) {
      const code = String(err).includes("nothing_to_send") ? "nothing_to_send" : "send_failed";
      logger.error({ action: "channelBroadcasts.sendNow", channelId, error: String(err) });
      res.status(code === "nothing_to_send" ? 400 : 500).json({ error: code });
    }
  });

  return router;
}
