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
  /** User docs newly created in the destination (no prior record existed). */
  users: number;
  /** Existing destination users whose state was merged with the source. */
  usersMerged: number;
  /** Existing destination users skipped without changes (only with userExistingBehavior="skip"). */
  usersSkipped: number;
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

export type UserExistingBehavior = "overwrite" | "skip" | "merge";

export interface MigrationOptions {
  chatConfig?: boolean;
  users?: boolean;
  bannedWords?: boolean;
  domainAllowances?: boolean;
  /** "all" copies warnings+bans; "bansOnly" copies just banned users with cleared warnings. */
  usersMode?: "all" | "bansOnly";
  /**
   * What to do when a destination user already exists:
   *   - "overwrite" (default, /migrar bot command): replace dest fields with source (legacy)
   *   - "skip": leave the dest record untouched
   *   - "merge": union(warningReasons), max(warnings), OR(isBanned), OR(wasBanned)
   */
  userExistingBehavior?: UserExistingBehavior;
}

/** Back-compat default: callers without options (e.g. /migrar bot command) get the
 *  pre-existing full-copy + overwrite-with-G3 behavior. */
const DEFAULT_OPTIONS: Required<MigrationOptions> = {
  chatConfig: true,
  users: true,
  bannedWords: true,
  domainAllowances: true,
  usersMode: "all",
  userExistingBehavior: "overwrite",
};

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
/**
 * Build the user upsert payload for a single source-user record. Handles both
 * `usersMode` ("all" vs "bansOnly") and `existingBehavior` (overwrite vs merge).
 * G3 (wasBanned never reverts) is enforced in every branch.
 *
 * Merge semantics (when dest exists and existingBehavior="merge"):
 *   - warnings:        max(dest, src)   — never decreases
 *   - warningReasons:  union (dedup)    — never loses information
 *   - isBanned:        dest OR src
 *   - wasBanned:       dest OR src OR derived from src.isBanned (G3)
 *
 *   In bansOnly mode the source contributes no warning state, so warnings /
 *   warningReasons are taken straight from dest.
 */
function buildUserPayload(
  src: IUser,
  existing: IUser | null,
  destChatId: number,
  usersMode: "all" | "bansOnly",
  isMerge: boolean
): Partial<IUser> {
  const srcIsBanned = src.isBanned === true;
  const srcWasBanned = src.wasBanned === true;
  const destIsBanned = existing?.isBanned === true;
  const destWasBanned = existing?.wasBanned === true;

  if (usersMode === "bansOnly") {
    if (isMerge && existing) {
      return {
        userId: src.userId,
        chatId: destChatId,
        // bansOnly contributes no warning state — keep dest's.
        warnings: existing.warnings ?? 0,
        warningReasons: [...(existing.warningReasons ?? [])],
        isBanned: destIsBanned || srcIsBanned,
        wasBanned: destWasBanned || srcWasBanned || srcIsBanned,
      };
    }
    return {
      userId: src.userId,
      chatId: destChatId,
      warnings: 0,
      warningReasons: [],
      isBanned: srcIsBanned,
      wasBanned: srcWasBanned || srcIsBanned || destWasBanned,
    };
  }

  // usersMode === "all"
  if (isMerge && existing) {
    const mergedReasons = Array.from(
      new Set([...(existing.warningReasons ?? []), ...(src.warningReasons ?? [])])
    );
    return {
      userId: src.userId,
      chatId: destChatId,
      warnings: Math.max(existing.warnings ?? 0, src.warnings ?? 0),
      warningReasons: mergedReasons,
      isBanned: destIsBanned || srcIsBanned,
      wasBanned: destWasBanned || srcWasBanned,
    };
  }
  return {
    userId: src.userId,
    chatId: destChatId,
    warnings: src.warnings,
    warningReasons: [...(src.warningReasons ?? [])],
    isBanned: src.isBanned,
    wasBanned: srcWasBanned || destWasBanned,
  };
}

export async function migrateChatData(
  sourceChatId: number,
  destChatId: number,
  actorUserId: number,
  options?: MigrationOptions
): Promise<MigrationSummary> {
  const opts: Required<MigrationOptions> = { ...DEFAULT_OPTIONS, ...(options ?? {}) };

  const source = await chatRepository.findByChatId(sourceChatId);
  if (!source) throw new Error("source_chat_not_found");
  const dest = await chatRepository.findByChatId(destChatId);
  if (!dest) throw new Error("dest_chat_not_found");

  const summary: MigrationSummary = {
    sourceChatId,
    destChatId,
    users: 0,
    usersMerged: 0,
    usersSkipped: 0,
    bannedWords: 0,
    bannedWordsSkipped: 0,
    domainAllowances: 0,
    configCopied: false,
    logsTo: source.logsTo ?? null,
  };

  // ── 1. Chat config ────────────────────────────────────────────────
  if (opts.chatConfig) {
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
  }

  // ── 2. Users (silenced status excluded; old chat wins; wasBanned never reverts) ──
  if (opts.users) {
    try {
      const users = await userRepository.findAllByChatId(sourceChatId);
      for (const u of users) {
        // bansOnly: drop users that aren't banned (warnings-only rows are ignored).
        if (opts.usersMode === "bansOnly") {
          if (!u.isBanned && !u.wasBanned) continue;
        } else {
          // "all": skip users with no moderation state.
          if (!u.warnings && !u.isBanned && !u.wasBanned) continue;
        }
        try {
          const existing = await userRepository.findByUserAndChat(u.userId, destChatId);
          // "skip": leave the destination user untouched.
          if (existing && opts.userExistingBehavior === "skip") {
            summary.usersSkipped++;
            continue;
          }
          const isMerge = existing != null && opts.userExistingBehavior === "merge";
          const payload: Partial<IUser> = buildUserPayload(u, existing, destChatId, opts.usersMode, isMerge);
          if (u.username) payload.username = u.username;
          if (u.name) payload.name = u.name;
          // isMuted / muteUntil intentionally omitted — new chat starts un-silenced.
          await userRepository.upsert(payload);
          if (isMerge) summary.usersMerged++;
          else summary.users++;
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
  }

  // ── 3. UserDomainAllowance ("mixtos") — per-user, not topic-scoped ──
  if (opts.domainAllowances) {
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
  }

  // ── 4. Banned words — scope "all" only (topic IDs differ between chats) ──
  if (opts.bannedWords) {
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
