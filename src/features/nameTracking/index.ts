import { Api } from "grammy";
import { IChat } from "../../types";
import { userRepository } from "../../db/repositories/userRepository";
import { chatRepository } from "../../db/repositories/chatRepository";
import { recordActivity } from "../../utils/activityLog";
import { logger } from "../../utils/logger";
import { esc, profileLink, mentionHtml } from "../../bot/helpers/html";
import { t } from "../../locales/i18n";

/**
 * SangMata-style identity tracker: notices when a user changes their name or @username and
 * keeps the DB fresh. The *notice* is feature-flagged (trackNameChanges, default off); the
 * DB refresh is not, because it is the plain membership bookkeeping every chat already did.
 * Notices go to the chat's `logsTo`; they reach the group itself only when
 * `nameChangesVisible` is also on.
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
// Soft hyphens and Hangul fillers are the "invisible name" trick: they render as nothing but
// compare as content, so a name built from them printed an empty half of the notice.
const INVISIBLE_CODES = new Set([
  0x00ad, 0x034f, 0x061c, 0x115f, 0x1160, 0x17b4, 0x17b5, 0x180e, 0x200b, 0x200e, 0x200f, 0x2060, 0x2061,
  0x2062, 0x2063, 0x2064, 0x3164, 0xfeff, 0xffa0,
]);
const stripInvisible = (s: string): string =>
  [...s].filter((c) => !INVISIBLE_CODES.has(c.codePointAt(0)!)).join("");
const norm = (s?: string | null): string =>
  stripInvisible((s ?? "").normalize("NFC"))
    .replace(/\s+/g, " ")
    .trim();

/** A name that is real but renders as nothing still needs something to show and compare. */
const display = (s?: string | null): string =>
  norm(s) || ((s ?? "").trim() ? t("nameTracker.invisibleName") : "");

/** Pure diff. null = nothing to announce. A first sighting (no stored name) is never a change. */
export function diffIdentity(stored: Identity, current: Identity): IdentityChange | null {
  const change: IdentityChange = {};

  const oldName = display(stored.name);
  const newName = display(current.name);
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
  const name = display(id.name);
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
  const nameChanged = display(before.name) !== display(after.name);
  const userChanged = norm(before.username) !== norm(after.username);
  const from = renderSide(userId, before, { linkName: !nameChanged, linkUser: !userChanged });
  let to = renderSide(userId, after, {
    linkName: true,
    linkUser: true,
    boldName: nameChanged,
    boldUser: userChanged,
  });
  // Dropping a handle otherwise reads as "nothing happened": the new side just loses a token.
  if (norm(before.username) && !norm(after.username)) to += ` (<b>${t("nameTracker.usernameRemoved")}</b>)`;
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

/** Plain-text form of a change, for the queryable audit trail. */
export function describeIdentityChange(change: IdentityChange): string {
  const parts: string[] = [];
  if (change.nameChange) parts.push(`${change.nameChange.from} → ${change.nameChange.to}`);
  if (change.usernameChange) {
    const from = change.usernameChange.from ? `@${change.usernameChange.from}` : "—";
    const to = change.usernameChange.to ? `@${change.usernameChange.to}` : "—";
    parts.push(`${from} → ${to}`);
  }
  return parts.join(" · ");
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
  // An invisible-but-present name is not that case: it keeps its row and shows a placeholder.
  if (!(current.name ?? "").trim()) {
    logger.warn({ action: "name_change_blank_observation", chatId, userId });
    return;
  }

  const row = await userRepository.findByUserAndChat(userId, chatId);
  const before: Identity = { name: row?.name, username: row?.username };

  // An unconfirmed row holds an unverified leftover (first name alone, or a lurker never read),
  // so adopting the first reading silently is what keeps that backlog out of the channel.
  const change = row?.identityConfirmedAt ? diffIdentity(before, current) : null;

  // Persisting is bookkeeping, not the feature: only the notice is flagged (G16).
  if (change && chatConfig.features?.trackNameChanges) {
    logger.info({ action: "name_change", chatId, userId, change });
    recordActivity({
      chatId,
      type: "name_change",
      source: "auto",
      actor: { id: userId, name: current.name, username: current.username },
      target: { id: userId, name: current.name, username: current.username },
      reason: describeIdentityChange(change),
    });
    await announce(api, chatConfig, chatId, buildIdentityChangeMessage(userId, before, current));
  }

  await userRepository.confirmIdentity(userId, chatId, current.name, current.username);
}

/**
 * Same observation, every chat the user belongs to — each chat still compares against its own
 * row and announces on its own flag. Name and @username are global, so a read taken for one
 * chat is valid for all; withholding it left the other chats stale.
 */
export async function trackIdentityEverywhere(api: Api, userId: number, current: Identity): Promise<void> {
  const rows = await userRepository.findAllForUser(userId);
  const chatIds = [...new Set(rows.map((r) => r.chatId))];
  if (chatIds.length === 0) return;

  const chats = await chatRepository.listByChatIds(chatIds);
  for (const chatConfig of chats) {
    if (chatConfig.isActive === false) continue;
    try {
      await trackIdentity(api, chatConfig, userId, chatConfig.chatId, current);
    } catch (err) {
      logger.error({ action: "track_identity_chat", chatId: chatConfig.chatId, userId, error: String(err) });
    }
  }
}
