import { Api } from "grammy";
import { IChat } from "../../types";
import { userRepository } from "../../db/repositories/userRepository";
import { logger } from "../../utils/logger";
import { esc, profileLink, mentionHtml } from "../../bot/helpers/html";
import { t } from "../../locales/i18n";

/**
 * SangMata-style identity tracker: notices when a user changes their name or @username and
 * keeps the DB fresh. Feature-flagged (trackNameChanges), default off.
 *
 * Notice: "Usuario <id> ha actualizado su perfil: <before> → <after>". The id is tap-to-copy
 * (<code>); a value is a clickable profile link only when it is the user's *current* value,
 * so old/replaced values stay plain and the change pops visually.
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

/** Renders one side ("Name (@user)"), linking each token only when it is the current value. */
function renderSide(userId: number, id: Identity, nameCurrent: boolean, userCurrent: boolean): string {
  const name = norm(id.name);
  const username = norm(id.username);
  const namePart = nameCurrent ? profileLink(userId, name) : esc(name);
  if (!username) return namePart;
  const userPart = userCurrent ? mentionHtml(userId, name, username) : `@${esc(username)}`;
  return `${namePart} (${userPart})`;
}

/** Builds the one-line HTML notice (pure, testable). */
export function buildIdentityChangeMessage(userId: number, before: Identity, after: Identity): string {
  const nameChanged = norm(before.name) !== norm(after.name);
  const userChanged = norm(before.username) !== norm(after.username);
  const from = renderSide(userId, before, !nameChanged, !userChanged);
  const to = renderSide(userId, after, true, true);
  return t("nameTracker.profileUpdated", { id: userId, from, to });
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
    const before: Identity = { name: stored.name, username: stored.username };
    const change = diffIdentity(before, current);
    if (change) {
      logger.info({ action: "name_change", chatId, userId, change });
      await announce(api, chatConfig, chatId, buildIdentityChangeMessage(userId, before, current));
    }
  }
  await userRepository.updateIdentity(userId, chatId, current.name, current.username);
}
