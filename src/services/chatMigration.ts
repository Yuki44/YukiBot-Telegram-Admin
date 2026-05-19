import { chatRepository } from "../db/repositories/chatRepository";
import { userRepository } from "../db/repositories/userRepository";
import { userDomainAllowanceRepository } from "../db/repositories/userDomainAllowanceRepository";
import { bannedWordRepository } from "../db/repositories/bannedWordRepository";
import { logger } from "../utils/logger";
import { IChat, IUser } from "../types";

/**
 * Canonical feature flags — mirrors the Chat schema (src/db/models/Chat.ts) and
 * FEATURE_KEYS in src/api/routes/chats.ts. Rebuilding `features` from this list
 * (instead of copying `source.features` verbatim) drops any stale legacy keys
 * (e.g. spamDetection/commands) an un-migrated old chat may still carry.
 */
const FEATURE_KEYS = [
  "languageDetection",
  "topicFiltering",
  "autoBan",
  "autoWarnSpam",
  "promoSpamDetection",
  "bannedWordsEnforcement",
] as const;

export interface MigrationSummary {
  sourceChatId: number;
  destChatId: number;
  /** User docs upserted into the destination chat. */
  users: number;
  /** scope==="all" banned words copied. */
  bannedWords: number;
  /** Banned words skipped because they already existed in the destination. */
  bannedWordsSkipped: number;
  /** UserDomainAllowance ("mixtos") docs copied. */
  domainAllowances: number;
  /** features/whitelist/linkWhitelist/spamUserWhitelist/logsTo applied to dest. */
  configCopied: boolean;
  /** Resolved destination logsTo channel (for the post-migration notification). */
  logsTo: number | null;
}

/**
 * Copy moderation state from a source chat into a destination chat that has
 * already run /setup. Each phase is independently guarded so a partial failure
 * still returns a summary of what succeeded; only a missing Chat document aborts.
 *
 * NOT copied (by design): ActivityLog (Registro), Admin (Equipo de admins),
 * Topic + topic-scoped banned words (topic IDs differ between chats), user
 * silenced status (isMuted/muteUntil), and destination identity/routing
 * (name/type/isActive/delegatedOwnerId/forwardsTo/photo/members).
 */
export async function migrateChatData(
  sourceChatId: number,
  destChatId: number,
  actorUserId: number
): Promise<MigrationSummary> {
  const source = await chatRepository.findByChatId(sourceChatId);
  if (!source) throw new Error("source_chat_not_found");
  const dest = await chatRepository.findByChatId(destChatId);
  if (!dest) throw new Error("dest_chat_not_found");

  const summary: MigrationSummary = {
    sourceChatId,
    destChatId,
    users: 0,
    bannedWords: 0,
    bannedWordsSkipped: 0,
    domainAllowances: 0,
    configCopied: false,
    logsTo: source.logsTo ?? null,
  };

  // ── 1. Chat config ────────────────────────────────────────────────
  try {
    const features: Record<string, boolean> = {};
    for (const k of FEATURE_KEYS) features[k] = source.features?.[k] === true;
    await chatRepository.upsert({
      chatId: destChatId,
      features: features as IChat["features"],
      whitelist: source.whitelist === true,
      linkWhitelist: [...(source.linkWhitelist ?? [])],
      spamUserWhitelist: [...(source.spamUserWhitelist ?? [])],
      logsTo: source.logsTo,
    });
    summary.configCopied = true;
  } catch (err) {
    logger.error({ action: "migrate.config", sourceChatId, destChatId, error: String(err) });
  }

  // ── 2. Users (silenced status excluded; old chat wins; wasBanned never reverts) ──
  try {
    const users = await userRepository.findAllByChatId(sourceChatId);
    for (const u of users) {
      // Skip users with no moderation state — nothing to preserve in the new chat.
      if (!u.warnings && !u.isBanned && !u.wasBanned) continue;
      try {
        const existing = await userRepository.findByUserAndChat(u.userId, destChatId);
        const payload: Partial<IUser> = {
          userId: u.userId,
          chatId: destChatId,
          warnings: u.warnings,
          warningReasons: [...(u.warningReasons ?? [])],
          isBanned: u.isBanned,
          // G3: wasBanned must NEVER revert to false.
          wasBanned: u.wasBanned === true || existing?.wasBanned === true,
        };
        if (u.username) payload.username = u.username;
        if (u.name) payload.name = u.name;
        // isMuted / muteUntil intentionally omitted — new chat starts un-silenced.
        await userRepository.upsert(payload);
        summary.users++;
      } catch (err) {
        logger.error({
          action: "migrate.user",
          sourceChatId,
          destChatId,
          userId: u.userId,
          error: String(err),
        });
      }
    }
  } catch (err) {
    logger.error({ action: "migrate.users", sourceChatId, destChatId, error: String(err) });
  }

  // ── 3. UserDomainAllowance ("mixtos") — per-user, not topic-scoped ──
  try {
    const allowances = await userDomainAllowanceRepository.findByChatId(sourceChatId);
    for (const a of allowances) {
      try {
        for (const domain of a.domains ?? []) {
          await userDomainAllowanceRepository.addDomain(a.userId, destChatId, domain);
        }
        summary.domainAllowances++;
      } catch (err) {
        logger.error({
          action: "migrate.allowance",
          sourceChatId,
          destChatId,
          userId: a.userId,
          error: String(err),
        });
      }
    }
  } catch (err) {
    logger.error({ action: "migrate.allowances", sourceChatId, destChatId, error: String(err) });
  }

  // ── 4. Banned words — scope "all" only (topic IDs differ between chats) ──
  try {
    const words = await bannedWordRepository.findByChatAndScope(sourceChatId, "all");
    for (const w of words) {
      try {
        await bannedWordRepository.create({
          chatId: destChatId,
          word: w.word,
          actions: {
            delete: w.actions?.delete === true,
            warn: w.actions?.warn === true,
            silence: w.actions?.silence === true,
          },
          kick: w.kick === true,
          flag: w.flag === true,
          warnReason: w.warnReason ?? null,
          exactMatch: w.exactMatch === true,
          scope: "all",
          createdBy: actorUserId,
        });
        summary.bannedWords++;
      } catch {
        // Unique index {chatId,word,scope,topicId}: the word already exists in dest.
        summary.bannedWordsSkipped++;
      }
    }
  } catch (err) {
    logger.error({ action: "migrate.bannedWords", sourceChatId, destChatId, error: String(err) });
  }

  logger.info({ action: "migrate", actorUserId, ...summary });
  return summary;
}

/**
 * Keep-or-deactivate the old chat after a migration. Nothing is ever deleted —
 * deactivation just flips `isActive` so the chat stops being processed.
 */
export async function setChatActive(chatId: number, active: boolean): Promise<IChat> {
  return await chatRepository.upsert({ chatId, isActive: active });
}
