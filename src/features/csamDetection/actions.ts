import { Api, InlineKeyboard } from "grammy";
import { IChat } from "../../types";
import { userRepository } from "../../db/repositories/userRepository";
import { chatRepository } from "../../db/repositories/chatRepository";
import { csamRecentMessageRepository } from "../../db/repositories/csamRecentMessageRepository";
import { recordActivity, ActivityActor } from "../../utils/activityLog";
import { logger } from "../../utils/logger";
import { esc, mentionHtml } from "../../bot/helpers/html";
import { SILENCE_DURATION_S, SILENCE_DURATION_MS } from "../../config/constants";

/**
 * CSAM/impostor enforcement + alerting.
 *
 * Two verdicts, deliberately asymmetric (see plan.md safety rules):
 *  - AUTO_BAN  → strict bio match; bans the id across EVERY managed chat and sets
 *                wasBanned everywhere (G3) so any rejoin is auto-rebanned.
 *  - SILENCE   → image OCR / uncertain bio; silences in the origin chat only and
 *                asks a human to confirm the ban. A false positive is cheap.
 *
 * Every hit raises a #CP_ALERTA in the log channel AND the notify chat, both
 * carrying inline buttons so a human closes the loop from Telegram.
 */

export type CsamVerdict = "AUTO_BAN" | "SILENCE";
export type CsamAction = "ban" | "qsil" | "undo";

/** Appended as the final line of every alert so this handle is pinged in the admin chat. */
const CSAM_NOTIFY_MENTION = "@edjoker";

export interface CsamTarget {
  userId: number;
  name?: string;
  username?: string;
}

// ── Callback data ────────────────────────────────────────────────────

/** "csam_<action>:chatId:userId" */
export function buildCsamCallback(action: CsamAction, chatId: number, userId: number): string {
  return `csam_${action}:${chatId}:${userId}`;
}

export function parseCsamCallback(
  data: string
): { verdict: CsamAction; chatId: number; userId: number } | null {
  const m = data.match(/^csam_(ban|qsil|undo):(-?\d+):(\d+)$/);
  if (!m) return null;
  return {
    verdict: m[1] as CsamAction,
    chatId: parseInt(m[2], 10),
    userId: parseInt(m[3], 10),
  };
}

// ── Alert message (pure, testable) ───────────────────────────────────

interface AlertParams {
  chatId: number;
  chatName: string;
  targetId: number;
  targetName?: string;
  targetUsername?: string;
  /** Human-readable summary of what matched, e.g. "nomax16 + ib, cc". */
  matchSummary: string;
  /** How many chats the ban was propagated to (AUTO_BAN only). */
  propagatedTo?: number;
}

export function buildCsamAlert(
  verdict: CsamVerdict,
  params: AlertParams
): { logText: string; notifyText: string; keyboard: InlineKeyboard } {
  const name = params.targetName ?? String(params.targetId);
  const who = mentionHtml(params.targetId, name, params.targetUsername);
  const grupo = `${esc(params.chatName)} [<code>${params.chatId}</code>]`;

  const header =
    verdict === "AUTO_BAN"
      ? "🚨 #CP_ALERTA — BANEO AUTOMÁTICO"
      : "🚨 #CP_ALERTA — SILENCIADO (revisión manual)";

  // Full audit detail for the log channel — no @edjoker ping here (G5 trail).
  const logLines = [
    header,
    `• Usuario: ${who} [<code>${params.targetId}</code>]`,
    `• Grupo: ${grupo}`,
    `• Coincidencia: <code>${esc(params.matchSummary)}</code>`,
  ];
  if (verdict === "AUTO_BAN") {
    logLines.push(`• Baneado en <b>${params.propagatedTo ?? 1}</b> chat(s). Revisa y reporta.`);
  } else {
    logLines.push("• Silenciado en este chat a la espera de revisión humana. Confirma el baneo o deshazlo.");
  }
  logLines.push(`#id${params.targetId}`);

  // Compact heads-up for the admin chat (detail lives in the log). Ends with the
  // mention so the admins get pinged; the buttons carry the ids to act on.
  const verdictShort = verdict === "AUTO_BAN" ? "baneo automático" : "silenciado — revisar";
  const notifyLines = [`🚨 #CP_ALERTA — ${verdictShort}`, `${who} · ${grupo}`, CSAM_NOTIFY_MENTION];

  const keyboard =
    verdict === "AUTO_BAN"
      ? new InlineKeyboard().text(
          "↩️ Deshacer (desbanear)",
          buildCsamCallback("undo", params.chatId, params.targetId)
        )
      : new InlineKeyboard()
          .text("🚫 Banear", buildCsamCallback("ban", params.chatId, params.targetId))
          .text("🔊 Quitar silencio", buildCsamCallback("qsil", params.chatId, params.targetId));

  return { logText: logLines.join("\n"), notifyText: notifyLines.join("\n"), keyboard };
}

// ── Alert delivery ───────────────────────────────────────────────────

/** Deep-link to a message inside a private supergroup/channel (the -100 prefix is stripped). */
export function buildRegistroKeyboard(chatId: number, messageId: number): InlineKeyboard {
  const internalId = String(chatId).replace(/^-100/, "");
  return new InlineKeyboard().url("📋 Ver registro", `https://t.me/c/${internalId}/${messageId}`);
}

/**
 * Post the alert: full detail + real action buttons to the log channel, and a
 * compact ping to the notify chat. The notify-chat ping only ever carries a
 * redirect to the log-channel message — never the real buttons — so a rushed
 * tap there can't act. If no log channel is configured there's nowhere to
 * redirect to, so the notify chat falls back to the real buttons directly.
 */
export async function sendCsamAlert(
  api: Api,
  chatConfig: IChat,
  alert: { logText: string; notifyText: string; keyboard: InlineKeyboard }
): Promise<void> {
  const notifyDest =
    chatConfig.notifyFlags?.notifyCsam && chatConfig.notifyChatId ? chatConfig.notifyChatId : null;

  let notifyKeyboard = alert.keyboard;

  if (chatConfig.logsTo) {
    try {
      const sent = await api.sendMessage(chatConfig.logsTo, alert.logText, {
        parse_mode: "HTML",
        reply_markup: alert.keyboard,
      });
      notifyKeyboard = buildRegistroKeyboard(chatConfig.logsTo, sent.message_id);
    } catch (err) {
      logger.error({
        action: "csam_alert_send",
        chatId: chatConfig.chatId,
        dest: chatConfig.logsTo,
        error: String(err),
      });
    }
  }

  if (notifyDest && notifyDest !== chatConfig.logsTo) {
    try {
      await api.sendMessage(notifyDest, alert.notifyText, {
        parse_mode: "HTML",
        reply_markup: notifyKeyboard,
      });
    } catch (err) {
      logger.error({
        action: "csam_alert_send",
        chatId: chatConfig.chatId,
        dest: notifyDest,
        error: String(err),
      });
    }
  }
}

// ── Enforcement ──────────────────────────────────────────────────────

/** Splits an array into groups of at most `size` — Telegram caps deleteMessages at 100 ids. */
export function chunk<T>(items: T[], size: number): T[][] {
  const groups: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    groups.push(items.slice(i, i + size));
  }
  return groups;
}

/** Deletes everything this user is known to have posted in one chat (best-effort). */
async function deleteRecentMessages(api: Api, chatId: number, userId: number): Promise<void> {
  const ids = await csamRecentMessageRepository.findMessageIds(userId, chatId);
  if (ids.length === 0) return;
  for (const group of chunk(ids, 100)) {
    try {
      await api.deleteMessages(chatId, group);
    } catch (err) {
      logger.error({ action: "csam_bulk_delete", chatId, userId, error: String(err) });
    }
  }
}

/** Ban an id across every active managed chat + mark wasBanned (G3). Returns chats touched. */
export async function banAcrossChats(api: Api, target: CsamTarget): Promise<number> {
  let chats: IChat[] = [];
  try {
    chats = (await chatRepository.listAll()).filter((c) => c.isActive !== false);
  } catch (err) {
    logger.error({ action: "csam_ban_listAll", error: String(err) });
  }
  let count = 0;
  for (const c of chats) {
    try {
      await api.banChatMember(c.chatId, target.userId);
    } catch {
      /* may not be a member / already gone — still record intent below */
    }
    await deleteRecentMessages(api, c.chatId, target.userId);
    try {
      await userRepository.markBanned(target.userId, c.chatId, target.username, target.name);
      count += 1;
    } catch (err) {
      logger.error({
        action: "csam_markBanned",
        chatId: c.chatId,
        userId: target.userId,
        error: String(err),
      });
    }
  }
  return count;
}

/** Unban an id across every active managed chat. wasBanned stays true forever (G3). */
export async function unbanAcrossChats(api: Api, target: CsamTarget): Promise<void> {
  let chats: IChat[] = [];
  try {
    chats = (await chatRepository.listAll()).filter((c) => c.isActive !== false);
  } catch (err) {
    logger.error({ action: "csam_unban_listAll", error: String(err) });
  }
  for (const c of chats) {
    try {
      await api.unbanChatMember(c.chatId, target.userId, { only_if_banned: true });
    } catch {
      /* silent */
    }
    try {
      await userRepository.upsert({ userId: target.userId, chatId: c.chatId, isBanned: false });
    } catch {
      /* silent */
    }
  }
}

/** Silence an id in a single chat + persist the mute. */
export async function silenceInChat(api: Api, chatId: number, target: CsamTarget): Promise<void> {
  try {
    await api.restrictChatMember(
      chatId,
      target.userId,
      {
        can_send_messages: false,
        can_send_audios: false,
        can_send_documents: false,
        can_send_photos: false,
        can_send_videos: false,
        can_send_video_notes: false,
        can_send_voice_notes: false,
        can_send_polls: false,
        can_send_other_messages: false,
        can_add_web_page_previews: false,
        can_change_info: false,
        can_invite_users: false,
        can_pin_messages: false,
      },
      { until_date: Math.floor(Date.now() / 1000) + SILENCE_DURATION_S }
    );
  } catch (err) {
    logger.error({ action: "csam_silence_restrict", chatId, userId: target.userId, error: String(err) });
  }
  try {
    await userRepository.upsert({
      userId: target.userId,
      chatId,
      username: target.username,
      name: target.name,
      isMuted: true,
      muteUntil: new Date(Date.now() + SILENCE_DURATION_MS),
    });
  } catch (err) {
    logger.error({ action: "csam_silence_persist", chatId, userId: target.userId, error: String(err) });
  }
}

// Full permission grant — Telegram caps these at the group's global defaults,
// which drops the per-user restriction entry entirely.
const UNRESTRICTED = {
  can_send_messages: true,
  can_send_audios: true,
  can_send_documents: true,
  can_send_photos: true,
  can_send_videos: true,
  can_send_video_notes: true,
  can_send_voice_notes: true,
  can_send_polls: true,
  can_send_other_messages: true,
  can_add_web_page_previews: true,
  can_change_info: true,
  can_invite_users: true,
  can_pin_messages: true,
} as const;

/** Silence an id in every active CSAM-protected chat, alerting per chat. Returns chats touched. */
export async function silenceAcrossChats(
  api: Api,
  originChat: IChat,
  target: CsamTarget,
  matchSummary: string,
  actor: ActivityActor
): Promise<number> {
  let chats: IChat[] = [];
  try {
    chats = (await chatRepository.listAll()).filter((c) => c.isActive !== false && c.features?.csamDetection);
  } catch (err) {
    logger.error({ action: "csam_silence_listAll", error: String(err) });
  }
  if (!chats.some((c) => c.chatId === originChat.chatId)) chats = [originChat, ...chats];

  for (const c of chats) {
    await silenceInChat(api, c.chatId, target);
    recordActivity({
      chatId: c.chatId,
      type: "csam_silence",
      source: "bot",
      actor,
      target: { id: target.userId, name: target.name, username: target.username },
      reason: `CP/impostor (revisión): ${matchSummary}`,
    });
    // One alert per chat so each qsil button only lifts the silence in its own chat.
    const alert = buildCsamAlert("SILENCE", {
      chatId: c.chatId,
      chatName: c.name,
      targetId: target.userId,
      targetName: target.name,
      targetUsername: target.username,
      matchSummary,
    });
    await sendCsamAlert(api, c, alert);
    logger.info({ action: "csam_silence", chatId: c.chatId, userId: target.userId });
  }
  return chats.length;
}

/** Lift a CSAM silence in a single chat + clear the mute. Returns whether Telegram accepted it. */
export async function unsilenceInChat(api: Api, chatId: number, target: CsamTarget): Promise<boolean> {
  let ok = false;
  try {
    await api.restrictChatMember(chatId, target.userId, UNRESTRICTED);
    ok = true;
  } catch (err) {
    logger.error({ action: "csam_unsilence_restrict", chatId, userId: target.userId, error: String(err) });
  }
  try {
    await userRepository.upsert({ userId: target.userId, chatId, isMuted: false, muteUntil: undefined });
  } catch (err) {
    logger.error({ action: "csam_unsilence_persist", chatId, userId: target.userId, error: String(err) });
  }
  return ok;
}

// ── High-level verdict executors ─────────────────────────────────────

/**
 * Strict bio match ⇒ ban across all chats, record the action, raise the alert.
 * This is the ONLY path allowed to ban without a human in the loop.
 */
export async function executeCsamAutoBan(
  api: Api,
  chatConfig: IChat,
  target: CsamTarget,
  matchSummary: string,
  actor: ActivityActor
): Promise<void> {
  const propagatedTo = await banAcrossChats(api, target);

  recordActivity({
    chatId: chatConfig.chatId,
    type: "csam_autoban",
    source: "bot",
    actor,
    target: { id: target.userId, name: target.name, username: target.username },
    reason: `CP/impostor: ${matchSummary} (propagado a ${propagatedTo} chat/s)`,
  });

  const alert = buildCsamAlert("AUTO_BAN", {
    chatId: chatConfig.chatId,
    chatName: chatConfig.name,
    targetId: target.userId,
    targetName: target.name,
    targetUsername: target.username,
    matchSummary,
    propagatedTo,
  });
  await sendCsamAlert(api, chatConfig, alert);

  logger.info({ action: "csam_autoban", chatId: chatConfig.chatId, userId: target.userId, propagatedTo });
}

/**
 * Image OCR / uncertain bio ⇒ silence across every CSAM-protected chat, recording
 * and alerting per chat so each qsil button only clears the silence in its own chat.
 */
export async function executeCsamSilence(
  api: Api,
  chatConfig: IChat,
  target: CsamTarget,
  matchSummary: string,
  actor: ActivityActor
): Promise<void> {
  await silenceAcrossChats(api, chatConfig, target, matchSummary, actor);
}
