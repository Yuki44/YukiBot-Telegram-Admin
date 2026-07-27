import { Api } from "grammy";
import { IChat } from "../../types";
import { userRepository } from "../../db/repositories/userRepository";
import { logger } from "../../utils/logger";
import { esc, profileLink } from "../../bot/helpers/html";
import { t } from "../../locales/i18n";

/**
 * SangMata-style identity tracker: notices when a user changes their name or @username and
 * keeps the DB fresh. Notice ids are tap-to-copy (<code>), names link to the profile even
 * without a username (tg://user?id=). Feature-flagged (trackNameChanges), default off.
 */

export interface Identity {
  name?: string;
  username?: string;
}

export interface IdentityChange {
  nameChange?: { from: string; to: string };
  usernameChange?: { from?: string; to?: string };
}

const norm = (s?: string): string => (s ?? "").trim();

/** Pure diff. null = nothing to announce. A first sighting (no stored name) is never a change. */
export function diffIdentity(stored: Identity, current: Identity): IdentityChange | null {
  const change: IdentityChange = {};

  const oldName = norm(stored.name);
  const newName = norm(current.name);
  if (oldName && newName && oldName !== newName) change.nameChange = { from: oldName, to: newName };

  const oldUser = norm(stored.username);
  const newUser = norm(current.username);
  if (oldUser !== newUser && (oldUser || newUser)) {
    change.usernameChange = { from: oldUser || undefined, to: newUser || undefined };
  }

  return change.nameChange || change.usernameChange ? change : null;
}

/** Builds the one-line HTML notice (pure, testable). */
export function buildIdentityChangeMessage(userId: number, change: IdentityChange): string {
  const parts: string[] = [];
  if (change.nameChange) {
    parts.push(
      `${profileLink(userId, change.nameChange.from)} → ${profileLink(userId, change.nameChange.to)}`
    );
  }
  if (change.usernameChange) {
    const from = change.usernameChange.from ? `@${esc(change.usernameChange.from)}` : t("nameTracker.none");
    const to = change.usernameChange.to ? `@${esc(change.usernameChange.to)}` : t("nameTracker.none");
    parts.push(`${from} → ${to}`);
  }
  return `🔄 ${parts.join(" · ")} · 🆔 <code>${userId}</code>`;
}

async function announce(api: Api, chatConfig: IChat, chatId: number, text: string): Promise<void> {
  try {
    await api.sendMessage(chatId, text, { parse_mode: "HTML", disable_notification: true });
  } catch (err) {
    logger.error({ action: "name_change_announce_group", chatId, error: String(err) });
  }
  if (chatConfig.logsTo && chatConfig.logsTo !== chatId) {
    try {
      await api.sendMessage(chatConfig.logsTo, text, { parse_mode: "HTML", disable_notification: true });
    } catch (err) {
      logger.error({ action: "name_change_announce_log", chatId, error: String(err) });
    }
  }
}

/** Compare against the stored record, announce any change, then persist the current identity. */
export async function trackIdentity(
  api: Api,
  chatConfig: IChat,
  userId: number,
  chatId: number,
  current: Identity
): Promise<void> {
  const stored = await userRepository.findByUserAndChat(userId, chatId);
  if (stored && norm(stored.name)) {
    const change = diffIdentity({ name: stored.name, username: stored.username }, current);
    if (change) {
      logger.info({ action: "name_change", chatId, userId, change });
      await announce(api, chatConfig, chatId, buildIdentityChangeMessage(userId, change));
    }
  }
  await userRepository.updateIdentity(userId, chatId, current.name, current.username);
}
