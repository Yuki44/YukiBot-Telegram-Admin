import { NextFunction } from "grammy";
import { Api } from "grammy";
import { BotContext } from "../../types";
import { adminRepository } from "../../db/repositories/adminRepository";
import { csamWatchlistRepository } from "../../db/repositories/csamWatchlistRepository";
import { csamImageCacheRepository } from "../../db/repositories/csamImageCacheRepository";
import { scanImage, ScanCandidate, ImageScanDeps } from "../../features/csamDetection/imageScan";
import { ocrImage } from "../../features/csamDetection/ocr";
import { executeCsamSilence, CsamTarget } from "../../features/csamDetection/actions";
import { logger } from "../../utils/logger";
import { CSAM_OCR_MAX_BYTES } from "../../config/constants";

/**
 * Extract a SINGLE STILL image to OCR from a message. Never a video stream —
 * for animations/videos/animated stickers we only ever read the thumbnail.
 */
function extractStill(msg: NonNullable<BotContext["message"]>): ScanCandidate | null {
  const caption = msg.caption ?? undefined;

  if (msg.photo && msg.photo.length > 0) {
    // Largest size that stays under the byte cap, else the smallest available.
    const sized = [...msg.photo].sort((a, b) => (a.file_size ?? 0) - (b.file_size ?? 0));
    const pick = [...sized].reverse().find((p) => (p.file_size ?? 0) <= CSAM_OCR_MAX_BYTES) ?? sized[0];
    return { fileId: pick.file_id, fileUniqueId: pick.file_unique_id, caption, fileSize: pick.file_size };
  }

  if (msg.document && /^image\/(png|jpe?g|webp|bmp)$/.test(msg.document.mime_type ?? "")) {
    return {
      fileId: msg.document.file_id,
      fileUniqueId: msg.document.file_unique_id,
      caption,
      fileSize: msg.document.file_size,
    };
  }

  if (msg.sticker) {
    // Static sticker → the sticker itself is a still image; otherwise its thumbnail.
    if (!msg.sticker.is_animated && !msg.sticker.is_video) {
      return { fileId: msg.sticker.file_id, fileUniqueId: msg.sticker.file_unique_id, caption };
    }
    if (msg.sticker.thumbnail) {
      return {
        fileId: msg.sticker.thumbnail.file_id,
        fileUniqueId: msg.sticker.thumbnail.file_unique_id,
        caption,
      };
    }
  }

  const thumbHolder = msg.animation ?? msg.video;
  if (thumbHolder?.thumbnail) {
    return {
      fileId: thumbHolder.thumbnail.file_id,
      fileUniqueId: thumbHolder.thumbnail.file_unique_id,
      caption,
    };
  }

  return null;
}

async function downloadFile(api: Api, fileId: string): Promise<Buffer> {
  const file = await api.getFile(fileId);
  if (!file.file_path) throw new Error("no file_path");
  const url = `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${file.file_path}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

/**
 * OCR-scan images in csamDetection-enabled chats. On a match: delete the image
 * and SILENCE the sender for human review (images NEVER auto-ban). Registered
 * BEFORE mediaForwardHandler so a matched CSAM image is never forwarded (S-rules).
 */
export async function csamImageScan(ctx: BotContext, next: NextFunction): Promise<void> {
  try {
    const chatConfig = ctx.chatConfig;
    if (!chatConfig?.features?.csamDetection) return await next();

    const msg = ctx.message;
    if (!msg) return await next();

    const sender = msg.from;
    if (!sender || sender.is_bot) return await next();

    if (ctx.isAdmin) return await next(); // G4 — never touch admin content
    if ((chatConfig.spamUserWhitelist ?? []).includes(sender.id)) return await next();
    try {
      if (await adminRepository.isChatAdmin(sender.id, msg.chat.id)) return await next();
    } catch {
      /* continue */
    }

    const candidate = extractStill(msg);
    if (!candidate) return await next();
    if (candidate.fileSize && candidate.fileSize > CSAM_OCR_MAX_BYTES) return await next();

    const deps: ImageScanDeps = {
      getConfig: () => csamWatchlistRepository.getConfig(),
      download: (fileId) => downloadFile(ctx.api, fileId),
      ocr: ocrImage,
      cacheGet: (fuid) => csamImageCacheRepository.get(fuid),
      cacheSet: (fuid, text) => csamImageCacheRepository.setText(fuid, text),
    };

    const result = await scanImage(candidate, deps);
    if (!result.matched) return await next();

    // Delete before anything else so the image cannot linger or be forwarded downstream.
    try {
      await ctx.api.deleteMessage(msg.chat.id, msg.message_id);
    } catch (err) {
      logger.error({ action: "csam_image_delete", chatId: msg.chat.id, error: String(err) });
    }

    const target: CsamTarget = {
      userId: sender.id,
      name: [sender.first_name, sender.last_name].filter(Boolean).join(" "),
      username: sender.username,
    };
    const matchToken = result.handle ?? result.keyword ?? "cp";
    const summary = `imagen (${result.source}): ${matchToken}`;
    const actor = { id: ctx.me.id, name: ctx.me.first_name, username: ctx.me.username };

    await executeCsamSilence(ctx.api, chatConfig, target, summary, actor);

    logger.info({
      action: "csam_image_match",
      chatId: msg.chat.id,
      userId: sender.id,
      source: result.source,
      match: matchToken,
    });
    // Handled — do NOT call next(): stops mediaForward/topic/spam from re-processing.
  } catch (err) {
    logger.error({ action: "csamImageScan", error: String(err) });
    return await next();
  }
}
