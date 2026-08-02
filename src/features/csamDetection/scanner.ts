import { Bot } from "grammy";
import { BotContext, IChat, IUser } from "../../types";
import { chatRepository } from "../../db/repositories/chatRepository";
import { userRepository } from "../../db/repositories/userRepository";
import { csamWatchlistRepository } from "../../db/repositories/csamWatchlistRepository";
import { evaluateBio, BioResult, WatchConfig } from "./matcher";
import { executeCsamAutoBan, executeCsamSilence, CsamTarget } from "./actions";
import { trackIdentity, Identity } from "../nameTracking";
import { fullName } from "../../bot/helpers/fullName";
import { logger } from "../../utils/logger";
import { ActivityActor } from "../../utils/activityLog";
import {
  CSAM_SCAN_SPACING_MS,
  CSAM_SCAN_BATCH,
  CSAM_SCAN_IDLE_MS,
  CSAM_SCAN_MIN_INTERVAL_MS,
  CSAM_SCAN_HEARTBEAT_MS,
  CSAM_URGENT_COOLDOWN_MS,
  CSAM_SCAN_MISS_LIMIT,
} from "../../config/constants";

/**
 * Rolling background bio scanner.
 *
 * Continuously walks the members of csamDetection-enabled chats, pulls each
 * user's global bio via getChat, and runs the STRICT `evaluateBio` predicate:
 *  - AUTO_BAN → ban across all chats (the only unattended ban path).
 *  - SILENCE  → silence in the origin chat + alert for human review.
 *
 * This rotation is the feature's only trigger independent of the message update:
 * OCR and the urgent queue both die when another bot deletes the message first. So
 * the loop never idles while anyone is past CSAM_SCAN_MIN_INTERVAL_MS, and adding
 * chats lengthens the cycle without raising the call rate.
 *
 * A small urgent queue lets a user who just posted jump the line, spending
 * this same rate-limited loop's next tick on them instead of extra API calls.
 */

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Human-readable summary of a bio match for the alert/audit trail (pure). */
export function summarizeBioMatch(r: BioResult): string {
  const parts = [r.handle ?? "?"];
  if (r.solicitation.length > 0) parts.push(r.solicitation.join(", "));
  if (r.negation.length > 0) parts.push(`neg: ${r.negation.join(", ")}`);
  return parts.join(" + ");
}

/** True when a bio is old enough (or never checked) to warrant an urgent re-check. */
export function isBioCheckStale(
  lastBioCheckAt: Date | undefined,
  now: Date = new Date(),
  cooldownMs: number = CSAM_URGENT_COOLDOWN_MS
): boolean {
  if (!lastBioCheckAt) return true;
  return now.getTime() - lastBioCheckAt.getTime() >= cooldownMs;
}

// ── Urgent queue (message-triggered priority checks) ──────────────────

interface UrgentEntry {
  userId: number;
  chatId: number;
}

const urgentQueue = new Map<number, UrgentEntry>();

/** Dedups by userId so a chatty user only occupies one queue slot. */
export function enqueueUrgentBioCheck(userId: number, chatId: number): void {
  if (!urgentQueue.has(userId)) urgentQueue.set(userId, { userId, chatId });
}

/** FIFO pop. */
export function dequeueUrgentBioCheck(): UrgentEntry | undefined {
  const next = urgentQueue.keys().next();
  if (next.done) return undefined;
  const entry = urgentQueue.get(next.value);
  urgentQueue.delete(next.value);
  return entry;
}

interface Profile {
  bio: string;
  name: string;
  username?: string;
  photoFileId: string | null;
}

async function fetchProfile(bot: Bot<BotContext>, userId: number): Promise<Profile | null> {
  try {
    const chat = await bot.api.getChat(userId);
    const p = chat as {
      bio?: string;
      first_name?: string;
      last_name?: string;
      username?: string;
      photo?: { small_file_id?: string };
    };
    return {
      bio: p.bio ?? "",
      name: fullName(p),
      username: p.username,
      photoFileId: p.photo?.small_file_id ?? null,
    };
  } catch (err) {
    // "chat not found" is the normal answer for a peer the bot can't resolve (~9 of every 10
    // reads). One ERROR line each buried Railway under tens of thousands of entries a day; the
    // aggregate already lives in the heartbeat's `failed` counter, so only surprises get a line.
    if (!isUnresolvablePeer(err)) {
      logger.warn({ action: "csam_bio_fetch_failed", userId, error: String(err) });
    }
    return null;
  }
}

/** Telegram's error text, lowercased — the only part of a Bot API failure worth matching on. */
function errorDescription(err: unknown): string {
  return String((err as { description?: string })?.description ?? err).toLowerCase();
}

/** getChat's peer-cache miss — expected background noise, not a failure worth a log line. */
function isUnresolvablePeer(err: unknown): boolean {
  const d = errorDescription(err);
  return d.includes("chat not found") || d.includes("user not found");
}

/**
 * Distinguishes "Telegram says this account cannot exist here" from "we couldn't ask right now".
 * Only the former may delete data: a demoted bot or a transient outage makes every probe in a
 * chat fail at once, and reading that as absence would wipe good rows wholesale.
 */
export function isDefinitiveAbsence(err: unknown): boolean {
  const d = errorDescription(err);
  if (d.includes("chat not found") || d.includes("bot is not a member")) return false; // chat-level
  return (
    d.includes("user not found") ||
    d.includes("user_id_invalid") ||
    d.includes("peer_id_invalid") ||
    d.includes("participant_id_invalid")
  );
}

/**
 * Presence probe for a user getChat keeps missing. getChatMember resolves regardless of the
 * peer cache, so it is the only way to tell a pure lurker from someone who already left —
 * and it carries the identity fields the missed getChat never delivered.
 * Returns the member's identity, or null when they are absent or the answer was inconclusive.
 */
async function probePresence(bot: Bot<BotContext>, chatId: number, userId: number): Promise<Identity | null> {
  let status: string;
  let user: { first_name?: string; last_name?: string; username?: string } | undefined;
  try {
    const member = await bot.api.getChatMember(chatId, userId);
    status = member.status;
    user = member.user;
  } catch (err) {
    // Never delete on a maybe: an inconclusive answer keeps the row for a later rotation.
    if (!isDefinitiveAbsence(err)) {
      logger.warn({ action: "csam_scan_presence_inconclusive", chatId, userId, error: String(err) });
      return null;
    }
    status = "left";
  }

  if (status === "left" || status === "kicked") {
    try {
      const deleted = await userRepository.markNotMember(userId, chatId);
      stats.pruned += 1;
      logger.info({ action: "csam_scan_pruned", chatId, userId, status, deleted });
    } catch (err) {
      logger.error({ action: "csam_scan_prune_failed", chatId, userId, error: String(err) });
    }
    return null;
  }

  await userRepository.clearBioMiss(userId, chatId).catch(() => {});
  return user ? { name: fullName(user), username: user.username } : null;
}

/** Rotation counters for the heartbeat. */
const stats = { checked: 0, urgent: 0, failed: 0, hits: 0, identity: 0, pruned: 0 };

/** Snapshot + reset of the heartbeat counters (exported for testing). */
export function takeScanStats(): typeof stats {
  const snapshot = { ...stats };
  stats.checked = 0;
  stats.urgent = 0;
  stats.failed = 0;
  stats.hits = 0;
  stats.identity = 0;
  stats.pruned = 0;
  return snapshot;
}

/** Announce/persist an identity observed by the rotation. Gated on its own flag (G16). */
async function recordIdentity(
  bot: Bot<BotContext>,
  chatConfig: IChat,
  userId: number,
  identity: Identity
): Promise<void> {
  if (!chatConfig.features?.trackNameChanges) return;
  try {
    await trackIdentity(bot.api, chatConfig, userId, chatConfig.chatId, identity);
    stats.identity += 1;
  } catch (err) {
    logger.error({ action: "csam_scan_identity", userId, error: String(err) });
  }
}

/** Fetch + evaluate one user's bio and act on the verdict. Shared by both queues. */
async function checkUserBio(
  bot: Bot<BotContext>,
  chatConfig: IChat,
  target: CsamTarget,
  config: WatchConfig,
  actor: ActivityActor
): Promise<void> {
  const profile = await fetchProfile(bot, target.userId);
  // Stamp first: a mid-action failure must not wedge the scanner, and an account that
  // can never be resolved must not starve the rotation by retrying forever.
  await userRepository.markBioChecked(target.userId);
  stats.checked += 1;

  if (profile === null) {
    stats.failed += 1;
    const misses = await userRepository.recordBioMiss(target.userId, chatConfig.chatId).catch(() => 0);
    // Only after repeated misses: the extra call is amortized over the users getChat
    // will never resolve, so resolvable members keep their full bio cadence.
    if (misses >= CSAM_SCAN_MISS_LIMIT) {
      const identity = await probePresence(bot, chatConfig.chatId, target.userId);
      if (identity) await recordIdentity(bot, chatConfig, target.userId, identity);
    }
    return;
  }

  await userRepository.clearBioMiss(target.userId, chatConfig.chatId).catch(() => {});

  // The avatar rides along in the getChat response, so caching it costs no API call. Only a
  // real photo is written: a response without one may just mean it isn't visible to us, and
  // blanking a known avatar would also suppress the dashboard's own refresh path.
  if (profile.photoFileId) {
    void userRepository.syncIdentityAcrossChats(target.userId, {
      photoFileId: profile.photoFileId,
      photoCheckedAt: new Date(),
    });
  }

  await recordIdentity(bot, chatConfig, target.userId, {
    name: profile.name,
    username: profile.username,
  });

  const result = evaluateBio(profile.bio, config);
  if (result.verdict === "NONE") return;

  stats.hits += 1;
  const summary = summarizeBioMatch(result);
  try {
    if (result.verdict === "AUTO_BAN") {
      await executeCsamAutoBan(bot.api, chatConfig, target, summary, actor);
    } else {
      await executeCsamSilence(bot.api, chatConfig, target, summary, actor);
    }
  } catch (err) {
    logger.error({ action: "csam_scan_action", userId: target.userId, error: String(err) });
  }
}

/** Spends this tick's getChat call on the next valid, still-stale urgent entry, if any. */
async function drainOneUrgent(
  bot: Bot<BotContext>,
  chatById: Map<number, IChat>,
  config: WatchConfig,
  actor: ActivityActor
): Promise<boolean> {
  for (;;) {
    const entry = dequeueUrgentBioCheck();
    if (!entry) return false;

    const chatConfig = chatById.get(entry.chatId);
    if (!chatConfig) continue;

    const user: IUser | null = await userRepository.findByUserAndChat(entry.userId, entry.chatId);
    if (user?.isBanned) continue; // already banned (e.g. an OCR hit won the race) — nothing to do
    if (!isBioCheckStale(user?.lastBioCheckAt)) continue;

    const target: CsamTarget = { userId: entry.userId, name: user?.name, username: user?.username };
    await checkUserBio(bot, chatConfig, target, config, actor);
    return true;
  }
}

/**
 * Process one batch of due users (urgent queue first). Exported for
 * integration testing / manual triggering. Returns the number processed.
 */
export async function runBioScanBatch(bot: Bot<BotContext>, actor: ActivityActor): Promise<number> {
  const chats = (await chatRepository.listAll()).filter(
    (c) => c.isActive !== false && c.features?.csamDetection
  );
  if (chats.length === 0) return 0;

  const chatById = new Map(chats.map((c) => [c.chatId, c]));
  const chatIds = chats.map((c) => c.chatId);
  const config = await csamWatchlistRepository.getConfig();
  const staleBefore = new Date(Date.now() - CSAM_SCAN_MIN_INTERVAL_MS);

  let processed = 0;

  for (let i = 0; i < CSAM_SCAN_BATCH; i++) {
    const didUrgent = await drainOneUrgent(bot, chatById, config, actor);
    if (didUrgent) {
      processed += 1;
      stats.urgent += 1;
      await sleep(CSAM_SCAN_SPACING_MS);
      continue;
    }

    const [next] = await userRepository.findDueForBioScan(chatIds, staleBefore, 1);
    if (!next) break;

    const chatConfig = chatById.get(next.chatId);
    if (!chatConfig) {
      logger.error({ action: "csam_scan_missing_chat", chatId: next.chatId, userId: next.userId });
      break;
    }

    const target: CsamTarget = { userId: next.userId, name: next.name, username: next.username };
    await checkUserBio(bot, chatConfig, target, config, actor);
    processed += 1;

    await sleep(CSAM_SCAN_SPACING_MS);
  }

  return processed;
}

let started = false;

/** Boot the never-ending scan loop (idempotent). Call once after the bot starts. */
export function startCsamScanner(bot: Bot<BotContext>): void {
  if (started) return;
  started = true;
  const actor: ActivityActor = {
    id: bot.botInfo.id,
    name: bot.botInfo.first_name,
    username: bot.botInfo.username,
  };
  logger.info({ action: "csam_scanner_start", minIntervalMs: CSAM_SCAN_MIN_INTERVAL_MS });
  void (async () => {
    let lastHeartbeat = Date.now();
    for (;;) {
      try {
        const processed = await runBioScanBatch(bot, actor);
        if (Date.now() - lastHeartbeat >= CSAM_SCAN_HEARTBEAT_MS) {
          lastHeartbeat = Date.now();
          logger.info({ action: "csam_scan_heartbeat", ...takeScanStats() });
        }
        if (processed === 0) await sleep(CSAM_SCAN_IDLE_MS);
      } catch (err) {
        logger.error({ action: "csam_scan_loop", error: String(err) });
        await sleep(CSAM_SCAN_IDLE_MS);
      }
    }
  })();
}
