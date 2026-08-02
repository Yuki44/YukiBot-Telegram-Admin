import { Api } from "grammy";
import { IChat } from "../../types";
import { userRepository } from "../../db/repositories/userRepository";
import { logger } from "../../utils/logger";
import { esc, profileLink, mentionHtml } from "../../bot/helpers/html";
import { t } from "../../locales/i18n";

/**
 * SangMata-style identity tracker: notices when a user changes their name or @username and
 * keeps the DB fresh. Feature-flagged (trackNameChanges), default off. Notices go to the
 * chat's `logsTo`; they reach the group itself only when `nameChangesVisible` is also on.
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

/**
 * Comparison form of a name. Telegram hands the same visible name back in different bytes
 * (composed vs decomposed accents, stray direction marks, doubled spaces), and each variant
 * would otherwise be announced as a change that reads "Ana → Ana". Emoji are left untouched:
 * ZWJ and variation selectors are part of the glyph, so "👨‍👩‍👧" and "❤️" survive intact.
 */
const INVISIBLE = /[\u200B\u200E\u200F\u2060\uFEFF]/g;
const norm = (s?: string | null): string =>
  (s ?? "").normalize("NFC").replace(INVISIBLE, "").replace(/\s+/g, " ").trim();

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

interface SideOptions {
  linkName: boolean;
  linkUser: boolean;
  boldName?: boolean;
  boldUser?: boolean;
}

const bold = (html: string, on?: boolean): string => (on ? `<b>${html}</b>` : html);

/** Renders one side ("Name (@user)"), linking each token only when it is the current value. */
function renderSide(userId: number, id: Identity, opts: SideOptions): string {
  const name = norm(id.name);
  const username = norm(id.username);
  const namePart = bold(opts.linkName ? profileLink(userId, name) : esc(name), opts.boldName);
  if (!username) return namePart;
  // Replaced handles go in <code>: Telegram auto-links any bare @handle, so a freed handle
  // renders as a live link to whoever registered it next — or to nothing at all.
  const userPart = opts.linkUser
    ? bold(mentionHtml(userId, name, username), opts.boldUser)
    : `<code>@${esc(username)}</code>`;
  return `${namePart} (${userPart})`;
}

/** Builds the HTML notice (pure, testable). */
export function buildIdentityChangeMessage(userId: number, before: Identity, after: Identity): string {
  const nameChanged = norm(before.name) !== norm(after.name);
  const userChanged = norm(before.username) !== norm(after.username);
  const from = renderSide(userId, before, { linkName: !nameChanged, linkUser: !userChanged });
  const to = renderSide(userId, after, {
    linkName: true,
    linkUser: true,
    boldName: nameChanged,
    boldUser: userChanged,
  });
  return t("nameTracker.profileUpdated", { id: userId, from, to });
}

async function announce(api: Api, chatConfig: IChat, chatId: number, text: string): Promise<void> {
  // The log channel always gets the notice; the group only when the visibility flag is on.
  if (chatConfig.features?.nameChangesVisible) {
    try {
      await api.sendMessage(chatId, text, { parse_mode: "HTML", disable_notification: true });
    } catch (err) {
      logger.error({ action: "name_change_announce_group", chatId, error: String(err) });
    }
  }
  if (chatConfig.logsTo && chatConfig.logsTo !== chatId) {
    try {
      await api.sendMessage(chatConfig.logsTo, text, { parse_mode: "HTML", disable_notification: true });
    } catch (err) {
      logger.error({ action: "name_change_announce_log", chatId, error: String(err) });
    }
  }
}

/**
 * Compare against this chat's own stored row, announce any change, then persist.
 * Strictly per-chat: cross-chat propagation is what turned one profile edit into a burst.
 */
export async function trackIdentity(
  api: Api,
  chatConfig: IChat,
  userId: number,
  chatId: number,
  current: Identity
): Promise<void> {
  // A blank name means Telegram gave us nothing readable (deleted account, unresolved peer).
  // Announcing it prints an empty half ("Va (@vavabaa) → ") and persisting it wipes good data.
  if (!norm(current.name)) {
    logger.warn({ action: "name_change_blank_observation", chatId, userId });
    return;
  }

  const row = await userRepository.findByUserAndChat(userId, chatId);
  const before: Identity = { name: row?.name, username: row?.username };

  // An unconfirmed row holds an unverified leftover (first name alone, or a lurker never read),
  // so adopting the first reading silently is what keeps that backlog out of the channel.
  const change = row?.identityConfirmedAt ? diffIdentity(before, current) : null;

  if (change) {
    logger.info({ action: "name_change", chatId, userId, change });
    await announce(api, chatConfig, chatId, buildIdentityChangeMessage(userId, before, current));
  }

  await userRepository.confirmIdentity(userId, chatId, current.name, current.username);
}
