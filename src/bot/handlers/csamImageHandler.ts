import { NextFunction } from "grammy";
import { Api } from "grammy";
import { BotContext } from "../../types";
import { adminRepository } from "../../db/repositories/adminRepository";
import { userRepository } from "../../db/repositories/userRepository";
import { csamWatchlistRepository } from "../../db/repositories/csamWatchlistRepository";
import { csamImageCacheRepository } from "../../db/repositories/csamImageCacheRepository";
import {
  scanImage,
  ScanCandidate,
  ImageScanDeps,
  ImageScanResult,
} from "../../features/csamDetection/imageScan";
import { ocrImage } from "../../features/csamDetection/ocr";
import { executeCsamAutoBan, executeCsamSilence, CsamTarget } from "../../features/csamDetection/actions";
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

/** e.g. "imagen (ocr): nomax16 + videos, for buy". */
function summarizeImageMatch(r: ImageScanResult): string {
  const parts = [r.handle, ...r.solicitation];
  if (r.keyword) parts.push(r.keyword);
  const detail = parts.filter(Boolean).join(", ") || r.keyword || "cp";
  return `imagen (${r.source}): ${detail}`;
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
 * OCR-scan images in csamDetection-enabled chats. On a match, delete the image and either
 * AUTO_BAN (strong hit) or SILENCE for review. Registered BEFORE mediaForwardHandler so a
 * matched CSAM image is never forwarded (S-rules).
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
    if (candidate.fileSize && candidate.fileSize > CSAM_OCR_MAX_BYTES) {
      // An oversized file bypassing OCR must never be silent.
      logger.warn({
        action: "csam_image_skipped_oversize",
        chatId: msg.chat.id,
        userId: sender.id,
        fileSize: candidate.fileSize,
        maxBytes: CSAM_OCR_MAX_BYTES,
      });
      return await next();
    }

    const deps: ImageScanDeps = {
      getConfig: () => csamWatchlistRepository.getConfig(),
      download: (fileId) => downloadFile(ctx.api, fileId),
      ocr: ocrImage,
      cacheGet: (fuid) => csamImageCacheRepository.get(fuid),
      cacheSet: (fuid, text) => csamImageCacheRepository.setText(fuid, text),
    };

    const result = await scanImage(candidate, deps);
    logger.info({
      action: "csam_image_scanned",
      chatId: msg.chat.id,
      userId: sender.id,
      source: result.source,
      verdict: result.verdict,
      textLen: result.text.length,
    });
    if (result.verdict === "NONE") return await next();

    // Delete the exact triggering message first (Telegram-confirmed) so it can't linger or be forwarded.
    try {
      await ctx.api.deleteMessage(msg.chat.id, msg.message_id);
      logger.info({
        action: "csam_image_deleted",
        chatId: msg.chat.id,
        messageId: msg.message_id,
        userId: sender.id,
        via: "image_scan",
      });
    } catch (err) {
      logger.error({
        action: "csam_image_delete",
        chatId: msg.chat.id,
        messageId: msg.message_id,
        error: String(err),
      });
    }

    // Bio scan may have banned them mid-OCR; image is deleted above regardless — just skip the dup alert.
    let alreadyBanned = false;
    try {
      alreadyBanned = (await userRepository.findByUserAndChat(sender.id, msg.chat.id))?.isBanned === true;
    } catch {
      /* continue */
    }
    if (alreadyBanned) {
      logger.info({ action: "csam_image_match_already_banned", chatId: msg.chat.id, userId: sender.id });
      return;
    }

    const target: CsamTarget = {
      userId: sender.id,
      name: [sender.first_name, sender.last_name].filter(Boolean).join(" "),
      username: sender.username,
    };
    const summary = summarizeImageMatch(result);
    const actor = { id: ctx.me.id, name: ctx.me.first_name, username: ctx.me.username };

    if (result.verdict === "AUTO_BAN") {
      await executeCsamAutoBan(ctx.api, chatConfig, target, summary, actor);
    } else {
      await executeCsamSilence(ctx.api, chatConfig, target, summary, actor);
    }

    logger.info({
      action: result.verdict === "AUTO_BAN" ? "csam_image_autoban" : "csam_image_silence",
      chatId: msg.chat.id,
      userId: sender.id,
      source: result.source,
      match: summary,
    });
    // Handled — do NOT call next(): stops mediaForward/topic/spam from re-processing.
  } catch (err) {
    logger.error({ action: "csamImageScan", error: String(err) });
    return await next();
  }
}
