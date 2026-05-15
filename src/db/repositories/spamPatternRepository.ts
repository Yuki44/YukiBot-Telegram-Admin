import { createHash } from "crypto";
import { SpamPattern, ISpamPattern } from "../models/SpamPattern";

/** Lower-case, collapse whitespace, strip leading/trailing spaces */
export function normalizeText(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

function buildHash(normalized: string): string {
  return createHash("sha256").update(normalized).digest("hex");
}

export const spamPatternRepository = {
  async add(
    chatId: number,
    text: string,
    addedByUserId: number,
    triggeredByUserId: number,
    mediaFileId?: string | null
  ): Promise<ISpamPattern> {
    const normalized = normalizeText(text);
    const normalizedHash = buildHash(normalized);
    const patternId = normalizedHash.slice(0, 7);

    const setFields: Record<string, unknown> = { text, patternId, addedByUserId, triggeredByUserId };
    if (mediaFileId !== undefined) setFields.mediaFileId = mediaFileId;

    return await SpamPattern.findOneAndUpdate(
      { chatId, normalizedHash },
      { $set: setFields },
      { upsert: true, returnDocument: "after", setDefaultsOnInsert: true }
    );
  },

  async removeByPatternId(chatId: number, patternId: string): Promise<boolean> {
    const result = await SpamPattern.deleteOne({ chatId, patternId });
    return result.deletedCount > 0;
  },

  /** Removes the most recent learned pattern triggered by this user (works even after they leave) */
  async removeByTriggeredUser(chatId: number, triggeredByUserId: number): Promise<ISpamPattern | null> {
    const pattern = await SpamPattern.findOne({ chatId, triggeredByUserId }, null, {
      sort: { createdAt: -1 },
    });
    if (!pattern) return null;
    await pattern.deleteOne();
    return pattern;
  },

  async findAll(chatId: number): Promise<ISpamPattern[]> {
    return await SpamPattern.find({ chatId });
  },

  async findRecentByChatId(chatId: number, limit: number): Promise<ISpamPattern[]> {
    return await SpamPattern.find({ chatId }).sort({ createdAt: -1 }).limit(limit);
  },

  async findByPatternId(chatId: number, patternId: string): Promise<ISpamPattern | null> {
    return await SpamPattern.findOne({ chatId, patternId });
  },

  /** Latest pattern record for a given (chat, triggeredBy) pair, regardless of review state. */
  async findLatestByTriggeredUser(
    chatId: number,
    triggeredByUserId: number
  ): Promise<ISpamPattern | null> {
    return await SpamPattern.findOne({ chatId, triggeredByUserId }, null, {
      sort: { createdAt: -1 },
    });
  },

  /** Stamp the most recent pattern for a user as reviewed-by-admin (idempotent). */
  async markLatestReviewed(
    chatId: number,
    triggeredByUserId: number,
    reviewer: { id: number; name?: string; username?: string }
  ): Promise<ISpamPattern | null> {
    const pattern = await SpamPattern.findOne({ chatId, triggeredByUserId }, null, {
      sort: { createdAt: -1 },
    });
    if (!pattern) return null;
    if (pattern.reviewedAt) return pattern; // already reviewed — no-op
    pattern.reviewedAt = new Date();
    pattern.reviewedById = reviewer.id;
    pattern.reviewedByName = reviewer.name ?? null;
    pattern.reviewedByUsername = reviewer.username ?? null;
    await pattern.save();
    return pattern;
  },

  /**
   * Returns the patternId of the first matching learned pattern, or null.
   * Pass the already-normalized text.
   */
  async matchesAny(chatId: number, normalizedText: string): Promise<string | null> {
    const hash = buildHash(normalizedText);
    const pattern = await SpamPattern.findOne({ chatId, normalizedHash: hash });
    return pattern?.patternId ?? null;
  },
};
