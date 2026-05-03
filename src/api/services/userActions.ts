import { Api } from "grammy";
import { IChat, IUser } from "../../types";
import { userRepository } from "../../db/repositories/userRepository";
import { sendLog, LogUser } from "../../bot/helpers/sendLog";
import { MAX_WARNINGS, SILENCE_DURATION_S, SILENCE_DURATION_MS } from "../../config/constants";
import { logger } from "../../utils/logger";
import { recordActivity } from "../../utils/activityLog";

/**
 * API-side user-action helpers.
 *
 * These mirror what the bot's `applyWarn` / `silenceUser` / `kk` / `bn` commands do, but take
 * Grammy's `Api` directly (no `BotContext`) so they can be invoked from Express routes.
 *
 * Each function:
 *  1. Updates MongoDB via the repository.
 *  2. Calls the relevant Telegram API endpoint to enforce the action on the user.
 *  3. Streams a structured log entry to `chatConfig.logsTo` (subject to the chat's logFlags),
 *     so the per-chat admin channel still records dashboard-initiated actions.
 *
 * Errors during enforcement do NOT roll back the DB write — the convention in YukiBot is that
 * the DB record is the source of truth and the bot will re-enforce on the user's next message.
 */

export interface ActorInfo {
  userId: number;
  name?: string;
  username?: string;
}

interface ActionResult {
  user: IUser;
  enforced: boolean;
  enforceError?: string;
}

function actorToLog(actor: ActorInfo): LogUser {
  return {
    id: actor.userId,
    name: actor.name ?? actor.username ?? String(actor.userId),
    username: actor.username,
  };
}

function targetToLog(user: IUser): LogUser {
  return {
    id: user.userId,
    name: user.name ?? user.username ?? String(user.userId),
    username: user.username,
  };
}

export async function warnUserViaApi(
  api: Api,
  chatConfig: IChat,
  targetUserId: number,
  actor: ActorInfo,
  reason: string
): Promise<ActionResult> {
  const updated = await userRepository.incrementWarning(targetUserId, chatConfig.chatId, reason);

  let enforced = true;
  let enforceError: string | undefined;

  if (updated.warnings >= MAX_WARNINGS) {
    try {
      await api.banChatMember(chatConfig.chatId, targetUserId);
    } catch (err) {
      enforced = false;
      enforceError = String(err);
      logger.error({
        action: "api.warn.autoban_failed",
        error: enforceError,
        chatId: chatConfig.chatId,
        userId: targetUserId,
      });
    }
    sendLog(api, chatConfig, {
      action: "BAN",
      actor: actorToLog(actor),
      target: targetToLog(updated),
      chatId: chatConfig.chatId,
      chatName: chatConfig.name,
      reason: "3 avisos (desde panel)",
    }).catch(() => {});

    recordActivity({
      chatId: chatConfig.chatId,
      type: "autoban",
      source: "panel",
      actor: { id: actor.userId, name: actor.name, username: actor.username },
      target: { id: updated.userId, name: updated.name, username: updated.username },
      reason: "3/3 avisos",
    });
  }

  sendLog(api, chatConfig, {
    action: "AVISO",
    actor: actorToLog(actor),
    target: targetToLog(updated),
    chatId: chatConfig.chatId,
    chatName: chatConfig.name,
    warnings: updated.warnings,
    reason,
  }).catch(() => {});

  recordActivity({
    chatId: chatConfig.chatId,
    type: "warn",
    source: "panel",
    actor: { id: actor.userId, name: actor.name, username: actor.username },
    target: { id: updated.userId, name: updated.name, username: updated.username },
    warningsAfter: updated.warnings,
    reason,
  });

  return { user: updated, enforced, enforceError };
}

export async function silenceUserViaApi(
  api: Api,
  chatConfig: IChat,
  targetUserId: number,
  actor: ActorInfo
): Promise<ActionResult> {
  let enforced = true;
  let enforceError: string | undefined;

  try {
    await api.restrictChatMember(
      chatConfig.chatId,
      targetUserId,
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
    enforced = false;
    enforceError = String(err);
    logger.error({
      action: "api.silence.failed",
      error: enforceError,
      chatId: chatConfig.chatId,
      userId: targetUserId,
    });
  }

  const muteUntil = new Date(Date.now() + SILENCE_DURATION_MS);
  const updated = await userRepository.upsert({
    userId: targetUserId,
    chatId: chatConfig.chatId,
    isMuted: true,
    muteUntil,
  });

  sendLog(api, chatConfig, {
    action: "SILENCIO",
    actor: actorToLog(actor),
    target: targetToLog(updated),
    chatId: chatConfig.chatId,
    chatName: chatConfig.name,
    muteUntil,
  }).catch(() => {});

  recordActivity({
    chatId: chatConfig.chatId,
    type: "silence",
    source: "panel",
    actor: { id: actor.userId, name: actor.name, username: actor.username },
    target: { id: updated.userId, name: updated.name, username: updated.username },
  });

  return { user: updated, enforced, enforceError };
}

export async function unsilenceUserViaApi(
  api: Api,
  chatConfig: IChat,
  targetUserId: number,
  actor: ActorInfo
): Promise<ActionResult> {
  let enforced = true;
  let enforceError: string | undefined;

  try {
    await api.restrictChatMember(chatConfig.chatId, targetUserId, {
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
      can_change_info: false,
      can_invite_users: true,
      can_pin_messages: false,
    });
  } catch (err) {
    enforced = false;
    enforceError = String(err);
    logger.error({
      action: "api.unsilence.failed",
      error: enforceError,
      chatId: chatConfig.chatId,
      userId: targetUserId,
    });
  }

  const updated = await userRepository.upsert({
    userId: targetUserId,
    chatId: chatConfig.chatId,
    isMuted: false,
    muteUntil: undefined,
  });

  sendLog(api, chatConfig, {
    action: "Q_SILENCIO",
    actor: actorToLog(actor),
    target: targetToLog(updated),
    chatId: chatConfig.chatId,
    chatName: chatConfig.name,
  }).catch(() => {});

  recordActivity({
    chatId: chatConfig.chatId,
    type: "unsilence",
    source: "panel",
    actor: { id: actor.userId, name: actor.name, username: actor.username },
    target: { id: updated.userId, name: updated.name, username: updated.username },
  });

  return { user: updated, enforced, enforceError };
}

export async function banUserViaApi(
  api: Api,
  chatConfig: IChat,
  targetUserId: number,
  actor: ActorInfo,
  reason?: string
): Promise<ActionResult> {
  let enforced = true;
  let enforceError: string | undefined;

  try {
    await api.banChatMember(chatConfig.chatId, targetUserId);
  } catch (err) {
    enforced = false;
    enforceError = String(err);
    logger.error({
      action: "api.ban.failed",
      error: enforceError,
      chatId: chatConfig.chatId,
      userId: targetUserId,
    });
  }

  const updated = await userRepository.markBanned(targetUserId, chatConfig.chatId);

  sendLog(api, chatConfig, {
    action: "BAN",
    actor: actorToLog(actor),
    target: targetToLog(updated),
    chatId: chatConfig.chatId,
    chatName: chatConfig.name,
    reason,
  }).catch(() => {});

  recordActivity({
    chatId: chatConfig.chatId,
    type: "ban",
    source: "panel",
    actor: { id: actor.userId, name: actor.name, username: actor.username },
    target: { id: updated.userId, name: updated.name, username: updated.username },
    reason,
  });

  return { user: updated, enforced, enforceError };
}

export async function unbanUserViaApi(
  api: Api,
  chatConfig: IChat,
  targetUserId: number,
  actor: ActorInfo
): Promise<ActionResult> {
  let enforced = true;
  let enforceError: string | undefined;

  try {
    await api.unbanChatMember(chatConfig.chatId, targetUserId, { only_if_banned: true });
  } catch (err) {
    enforced = false;
    enforceError = String(err);
    logger.error({
      action: "api.unban.failed",
      error: enforceError,
      chatId: chatConfig.chatId,
      userId: targetUserId,
    });
  }

  const updated = await userRepository.upsert({
    userId: targetUserId,
    chatId: chatConfig.chatId,
    isBanned: false,
    // wasBanned remains true forever (G3)
  });

  sendLog(api, chatConfig, {
    action: "Q_BAN",
    actor: actorToLog(actor),
    target: targetToLog(updated),
    chatId: chatConfig.chatId,
    chatName: chatConfig.name,
  }).catch(() => {});

  recordActivity({
    chatId: chatConfig.chatId,
    type: "unban",
    source: "panel",
    actor: { id: actor.userId, name: actor.name, username: actor.username },
    target: { id: updated.userId, name: updated.name, username: updated.username },
  });

  return { user: updated, enforced, enforceError };
}

/**
 * "Pardon" = clear all warnings + remove the User document entirely. Used when an admin wants
 * a clean slate. Mirrors the bot's `/qban`-then-clear flow but in one click.
 *
 * Owner-only at the route level. Does NOT call any Telegram endpoint — it's purely a DB cleanup,
 * because banned/silenced state was already cleared if needed.
 */
export async function pardonUserViaApi(
  chatId: number,
  targetUserId: number,
  actor?: ActorInfo
): Promise<void> {
  await userRepository.remove(targetUserId, chatId);
  if (actor) {
    recordActivity({
      chatId,
      type: "pardon",
      source: "panel",
      actor: { id: actor.userId, name: actor.name, username: actor.username },
      target: { id: targetUserId },
    });
  }
}
