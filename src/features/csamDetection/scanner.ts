import { Bot } from "grammy";
import { BotContext, IChat, IUser } from "../../types";
import { chatRepository } from "../../db/repositories/chatRepository";
import { userRepository } from "../../db/repositories/userRepository";
import { csamWatchlistRepository } from "../../db/repositories/csamWatchlistRepository";
import { evaluateBio, BioResult, WatchConfig } from "./matcher";
import { executeCsamAutoBan, executeCsamSilence, CsamTarget } from "./actions";
import { logger } from "../../utils/logger";
import { ActivityActor } from "../../utils/activityLog";
import {
  CSAM_SCAN_SPACING_MS,
  CSAM_SCAN_BATCH,
  CSAM_SCAN_IDLE_MS,
  CSAM_SCAN_RECHECK_MS,
  CSAM_URGENT_COOLDOWN_MS,
} from "../../config/constants";

/**
 * Rolling background bio scanner.
 *
 * Continuously walks the members of csamDetection-enabled chats, pulls each
 * user's global bio via getChat, and runs the STRICT `evaluateBio` predicate:
 *  - AUTO_BAN → ban across all chats (the only unattended ban path).
 *  - SILENCE  → silence in the origin chat + alert for human review.
 *
 * A single sequential worker with fixed spacing keeps well under Telegram's
 * rate limits, and `lastBioCheckAt` gives never-checked users priority while
 * still re-checking everyone every CSAM_SCAN_RECHECK_MS (the "clean bio at
 * join, sales pitch later" trick).
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

async function fetchBio(bot: Bot<BotContext>, userId: number): Promise<string | null> {
  try {
    const chat = await bot.api.getChat(userId);
    return chat.bio ?? "";
  } catch {
    // User can't be resolved (never shared a resolvable chat / deleted account).
    return null;
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
  const bio = await fetchBio(bot, target.userId);
  // Stamp first so a mid-action failure never wedges the scanner on one user.
  await userRepository.markBioChecked(target.userId);
  if (!bio) return;

  const result = evaluateBio(bio, config);
  if (result.verdict === "NONE") return;

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
  const staleBefore = new Date(Date.now() - CSAM_SCAN_RECHECK_MS);

  let processed = 0;

  for (let i = 0; i < CSAM_SCAN_BATCH; i++) {
    const didUrgent = await drainOneUrgent(bot, chatById, config, actor);
    if (didUrgent) {
      processed += 1;
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
  logger.info({ action: "csam_scanner_start" });
  void (async () => {
    for (;;) {
      try {
        const processed = await runBioScanBatch(bot, actor);
        if (processed === 0) await sleep(CSAM_SCAN_IDLE_MS);
      } catch (err) {
        logger.error({ action: "csam_scan_loop", error: String(err) });
        await sleep(CSAM_SCAN_IDLE_MS);
      }
    }
  })();
}
