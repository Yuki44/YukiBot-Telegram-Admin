import { bannedWordRepository } from "../../db/repositories/bannedWordRepository";
import { IBannedWord } from "../../types";
import { logger } from "../../utils/logger";

const TTL_MS = 30_000;

interface Entry {
  rules: IBannedWord[];
  at: number;
}

const cache = new Map<number, Entry>();

export async function getActiveRules(chatId: number): Promise<IBannedWord[]> {
  const cached = cache.get(chatId);
  if (cached && Date.now() - cached.at < TTL_MS) return cached.rules;

  try {
    const rules = await bannedWordRepository.findByChatId(chatId);
    cache.set(chatId, { rules, at: Date.now() });
    return rules;
  } catch (err) {
    logger.error({ action: "bannedWordsCache.load", chatId, error: String(err) });
    return cached?.rules ?? [];
  }
}

export function invalidateBannedWordsCache(chatId: number): void {
  cache.delete(chatId);
}
