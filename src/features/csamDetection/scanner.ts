import { Bot } from "grammy";
import { BotContext } from "../../types";
import { chatRepository } from "../../db/repositories/chatRepository";
import { userRepository } from "../../db/repositories/userRepository";
import { csamWatchlistRepository } from "../../db/repositories/csamWatchlistRepository";
import { evaluateBio, BioResult } from "./matcher";
import { executeCsamAutoBan, executeCsamSilence, CsamTarget } from "./actions";
import { logger } from "../../utils/logger";
import { ActivityActor } from "../../utils/activityLog";
import {
  CSAM_SCAN_SPACING_MS,
  CSAM_SCAN_BATCH,
  CSAM_SCAN_IDLE_MS,
  CSAM_SCAN_RECHECK_MS,
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
 */

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Human-readable summary of a bio match for the alert/audit trail (pure). */
export function summarizeBioMatch(r: BioResult): string {
  const parts = [r.handle ?? "?"];
  if (r.solicitation.length > 0) parts.push(r.solicitation.join(", "));
  if (r.negation.length > 0) parts.push(`neg: ${r.negation.join(", ")}`);
  return parts.join(" + ");
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

/**
 * Process one batch of due users. Exported for integration testing / manual
 * triggering. Returns the number of distinct users actually checked.
 */
export async function runBioScanBatch(bot: Bot<BotContext>, actor: ActivityActor): Promise<number> {
  const chats = (await chatRepository.listAll()).filter(
    (c) => c.isActive !== false && c.features?.csamDetection
  );
  if (chats.length === 0) return 0;

  const chatById = new Map(chats.map((c) => [c.chatId, c]));
  const staleBefore = new Date(Date.now() - CSAM_SCAN_RECHECK_MS);
  const due = await userRepository.findDueForBioScan(
    chats.map((c) => c.chatId),
    staleBefore,
    CSAM_SCAN_BATCH
  );
  if (due.length === 0) return 0;

  const config = await csamWatchlistRepository.getConfig();
  const seen = new Set<number>();
  let processed = 0;

  for (const u of due) {
    if (seen.has(u.userId)) continue;
    seen.add(u.userId);

    const chatConfig = chatById.get(u.chatId);
    if (!chatConfig) continue;

    const bio = await fetchBio(bot, u.userId);
    // Stamp first so a mid-action failure never wedges the scanner on one user.
    await userRepository.markBioChecked(u.userId);
    processed += 1;

    if (bio) {
      const result = evaluateBio(bio, config);
      if (result.verdict !== "NONE") {
        const target: CsamTarget = { userId: u.userId, name: u.name, username: u.username };
        const summary = summarizeBioMatch(result);
        try {
          if (result.verdict === "AUTO_BAN") {
            await executeCsamAutoBan(bot.api, chatConfig, target, summary, actor);
          } else {
            await executeCsamSilence(bot.api, chatConfig, target, summary, actor);
          }
        } catch (err) {
          logger.error({ action: "csam_scan_action", userId: u.userId, error: String(err) });
        }
      }
    }

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
