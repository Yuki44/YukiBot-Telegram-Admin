import { Api } from "grammy";
import { IUser } from "../../types";
import { userRepository } from "../../db/repositories/userRepository";
import { logger } from "../../utils/logger";

const PHOTO_RECHECK_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Whether a cached User.photoFileId is stale enough to warrant a refresh via
 * getUserProfilePhotos. Telegram doesn't expose a change feed for avatars, so
 * we check at most once per week — enough to catch most users updating their
 * profile pic without burning bot-API quota on every dashboard render.
 */
export function shouldRecheckPhoto(u: IUser): boolean {
  if (!u.photoCheckedAt) return true;
  return Date.now() - u.photoCheckedAt.getTime() > PHOTO_RECHECK_MS;
}

/**
 * Cache the smallest available profile-photo file_id for a user. Stores `null`
 * if the user has no photo (or the bot can't see it) so we don't re-call the
 * API on every avatar render. Safe to call repeatedly — silent on Telegram API
 * failure (logged at WARN), the caller doesn't need to await failure paths.
 */
export async function discoverProfilePhoto(api: Api, userId: number, chatId: number): Promise<void> {
  try {
    const photos = await api.getUserProfilePhotos(userId, { limit: 1 });
    // photos.photos is PhotoSize[][] — outer is "photos" (we asked for 1),
    // inner is the same photo at multiple resolutions, smallest first.
    const smallest = photos.photos[0]?.[0];
    const fileId = smallest?.file_id ?? null;
    const now = new Date();

    await userRepository.upsert({
      userId,
      chatId,
      photoFileId: fileId,
      photoCheckedAt: now,
    });

    // The avatar is identity-level, not chat-level — fan out to every chat where
    // we already know this user. Fire-and-forget; the repository swallows errors.
    void userRepository.syncIdentityAcrossChats(userId, {
      photoFileId: fileId,
      photoCheckedAt: now,
    });
  } catch (err) {
    logger.warn({
      action: "profilePhoto.discover_failed",
      chatId,
      userId,
      error: String(err),
    });
  }
}
