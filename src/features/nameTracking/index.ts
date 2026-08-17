import { Api } from "grammy";
import { IChat, IdentityObservationInput, IdentitySource } from "../../types";
import { userRepository } from "../../db/repositories/userRepository";
import { chatRepository } from "../../db/repositories/chatRepository";
import { identityObservationRepository } from "../../db/repositories/identityObservationRepository";
import { recordActivity } from "../../utils/activityLog";
import { logger } from "../../utils/logger";
import { esc, profileLink } from "../../bot/helpers/html";
import { t } from "../../locales/i18n";

/**
 * SangMata-style identity tracker: notices when a user changes their name or @username and
 * keeps the DB fresh. The *notice* is feature-flagged (trackNameChanges, default off); the
 * DB refresh is not, because it is the plain membership bookkeeping every chat already did.
 * Notices go to the chat's `logsTo`; they reach the group itself only when
 * `nameChangesVisible` is also on.
 *
 * Notice: "<id> ha actualizado su <what>: <before> → <after>". The id is tap-to-copy
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

/**
 * True when nothing of the string reaches the screen. Variation selectors and ZWJ stay out of
 * INVISIBLE_CODES so emoji still compare intact, but a name made only of them renders blank.
 */
const rendersAsNothing = (s: string): boolean =>
  [...s].every((c) => {
    const cp = c.codePointAt(0)!;
    return (
      INVISIBLE_CODES.has(cp) ||
      cp === 0x200d ||
      (cp >= 0xfe00 && cp <= 0xfe0f) ||
      (cp >= 0xe0100 && cp <= 0xe01ef) ||
      /\s/.test(c)
    );
  });

/** A name that is real but renders as nothing still needs something to show and compare. */
const display = (s?: string | null): string => {
  if (!(s ?? "").trim()) return "";
  const value = norm(s);
  return value && !rendersAsNothing(value) ? value : t("nameTracker.invisibleName");
};

/** Replaced handles never link: the account may have freed one, and Telegram links bare @.
 * The word joiner after @ keeps it visible as @handle yet un-clickable. */
const inertHandle = (username: string): string => `<i>@\u2060${esc(username)}</i>`;

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
  /** The user's *current* handle — what any working link has to point at. */
  currentUsername?: string;
  /** When the handle changed, an empty side reads "(vacío)" so the add/remove is explicit. */
  showEmptyUsername?: boolean;
  /** Group copy: never emit a tg://user?id= name link — that mention is what pings the user.
   * Without a handle the name falls back to bold text (still pops, no notification). */
  mentionSafe?: boolean;
}

const bold = (html: string, on?: boolean): string => (on ? `<b>${html}</b>` : html);

/** Renders one side ("Name (@user)"), linking each token only when it is the current value. */
function renderSide(userId: number, id: Identity, opts: SideOptions): string {
  const name = display(id.name);
  const username = norm(id.username);
  // A name link with no current handle can only be tg://user?id= — the mention that pings.
  // In the group copy we withhold that link; the caller edits it back in silently afterward.
  const nameLinked = opts.linkName && !(opts.mentionSafe && !opts.currentUsername);
  const namePart = bold(
    nameLinked ? profileLink(userId, name, opts.currentUsername) : esc(name),
    opts.boldName
  );
  if (!username) {
    if (!opts.showEmptyUsername) return namePart;
    return `${namePart} (${bold(t("nameTracker.usernameRemoved"), opts.boldUser)})`;
  }
  const userPart = opts.linkUser
    ? bold(profileLink(userId, `@${username}`, username), opts.boldUser)
    : inertHandle(username);
  return `${namePart} (${userPart})`;
}

/** perfil (both moved) · nombre (name only) · nombre de usuario (handle only). */
function changedWord(nameChanged: boolean, userChanged: boolean): string {
  if (nameChanged && userChanged) return t("nameTracker.profileWord");
  return nameChanged ? t("nameTracker.nameWord") : t("nameTracker.usernameWord");
}

/** Unreadable names carry nothing: with only the handle moving, it is the whole notice. */
function buildHandleOnlyMessage(userId: number, before: Identity, after: Identity): string {
  const oldHandle = norm(before.username);
  const newHandle = norm(after.username);
  const from = oldHandle ? inertHandle(oldHandle) : t("nameTracker.usernameRemoved");
  const to = newHandle
    ? `<b>${profileLink(userId, `@${newHandle}`, newHandle)}</b>`
    : `<b>${t("nameTracker.usernameRemoved")}</b>`;
  return t("nameTracker.profileUpdated", { id: userId, what: t("nameTracker.usernameWord"), from, to });
}

/**
 * Builds the HTML notice (pure, testable). With `mentionSafe`, a name that would otherwise link
 * via tg://user?id= is rendered as bold text instead — the group copy that must not ping.
 */
export function buildIdentityChangeMessage(
  userId: number,
  before: Identity,
  after: Identity,
  opts: { mentionSafe?: boolean } = {}
): string {
  const nameChanged = display(before.name) !== display(after.name);
  const userChanged = norm(before.username) !== norm(after.username);
  const afterName = display(after.name);
  if (!nameChanged && userChanged && (!afterName || afterName === t("nameTracker.invisibleName"))) {
    return buildHandleOnlyMessage(userId, before, after);
  }
  const currentUsername = norm(after.username) || undefined;
  const from = renderSide(userId, before, {
    linkName: !nameChanged,
    linkUser: !userChanged,
    currentUsername,
    showEmptyUsername: userChanged,
    mentionSafe: opts.mentionSafe,
  });
  const to = renderSide(userId, after, {
    linkName: true,
    linkUser: true,
    boldName: nameChanged,
    boldUser: userChanged,
    currentUsername,
    showEmptyUsername: userChanged,
    mentionSafe: opts.mentionSafe,
  });
  return t("nameTracker.profileUpdated", {
    id: userId,
    what: changedWord(nameChanged, userChanged),
    from,
    to,
  });
}

async function announce(
  api: Api,
  chatConfig: IChat,
  chatId: number,
  userId: number,
  before: Identity,
  after: Identity
): Promise<void> {
  const send = { parse_mode: "HTML", disable_notification: true } as const;
  const fullText = buildIdentityChangeMessage(userId, before, after);

  // The log channel always gets the notice; the group only when the visibility flag is on.
  if (chatConfig.features?.nameChangesVisible) {
    try {
      const safeText = buildIdentityChangeMessage(userId, before, after, { mentionSafe: true });
      if (safeText === fullText) {
        // No tg:// mention in play (handle links and https links never ping) — one send.
        await api.sendMessage(chatId, fullText, send);
      } else {
        // Ninja-edit: post the mention-free bold copy, then edit the tg://user?id= profile
        // link in. A mention added by an edit keeps the colour and the tap-to-profile without
        // ever firing the notification a fresh mention would.
        const sent = await api.sendMessage(chatId, safeText, send);
        await api.editMessageText(chatId, sent.message_id, fullText, { parse_mode: "HTML" });
      }
    } catch (err) {
      logger.error({ action: "name_change_announce_group", chatId, error: String(err) });
    }
  }
  if (chatConfig.logsTo && chatConfig.logsTo !== chatId) {
    try {
      await api.sendMessage(chatConfig.logsTo, fullText, send);
    } catch (err) {
      logger.error({ action: "name_change_announce_log", chatId, error: String(err) });
    }
  }
}

/** Diagnostics on its own flag (G16): tells a change we swallowed from one we never saw. */
function observe(chatConfig: IChat, obs: IdentityObservationInput): void {
  if (!chatConfig.features?.identityObservations) return;
  void identityObservationRepository.record(obs);
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
 * Returns whether the observation differed from what this chat had stored — the caller uses
 * that to decide whether the read is worth spending on the other chats (see trackIdentityEverywhere).
 */
export async function trackIdentity(
  api: Api,
  chatConfig: IChat,
  userId: number,
  chatId: number,
  current: Identity,
  source: IdentitySource = "message"
): Promise<boolean> {
  const row = await userRepository.findByUserAndChat(userId, chatId);
  const before: Identity = { name: row?.name, username: row?.username };
  const nameMissing = !(current.name ?? "").trim();
  const usernameMissing = !norm(current.username);

  if (nameMissing && usernameMissing) {
    logger.warn({ action: "name_change_blank_observation", chatId, userId });
    observe(chatConfig, {
      userId,
      chatId,
      source,
      outcome: "blank_skipped",
      observedUsername: current.username,
    });
    return false;
  }

  const effectiveCurrent: Identity = {
    name: nameMissing ? before.name : current.name,
    username: current.username,
  };
  if (nameMissing) {
    logger.warn({ action: "name_change_blank_observation", chatId, userId, fallback: "username_only" });
  }
  const diff = diffIdentity(before, effectiveCurrent);

  // An unconfirmed row holds an unverified leftover (first name alone, or a lurker never read),
  // so adopting the first reading silently is what keeps that backlog out of the channel.
  const change = row?.identityConfirmedAt ? diff : null;
  if (diff && !change) {
    logger.info({ action: "name_change_baseline_adopted", chatId, userId, before, current });
  }
  const announced = change !== null && chatConfig.features?.trackNameChanges === true;

  observe(chatConfig, {
    userId,
    chatId,
    source,
    outcome: announced ? "announced" : change ? "notice_disabled" : diff ? "baseline_adopted" : "no_diff",
    storedName: before.name,
    storedUsername: before.username,
    observedName: effectiveCurrent.name,
    observedUsername: current.username,
  });

  // Persisting is bookkeeping, not the feature: only the notice is flagged (G16).
  if (announced) {
    logger.info({ action: "name_change", chatId, userId, change });
    recordActivity({
      chatId,
      type: "name_change",
      source: "auto",
      actor: { id: userId, name: effectiveCurrent.name, username: effectiveCurrent.username },
      target: { id: userId, name: effectiveCurrent.name, username: effectiveCurrent.username },
      reason: describeIdentityChange(change),
    });
    await announce(api, chatConfig, chatId, userId, before, effectiveCurrent);
  }

  if (nameMissing) {
    await userRepository.updateIdentityUsername(userId, chatId, current.username);
  } else {
    await userRepository.confirmIdentity(userId, chatId, current.name, current.username);
  }
  return diff !== null;
}

/**
 * Same observation, every chat the user belongs to — each chat still compares against its own
 * row and announces on its own flag. Name and @username are global, so a read taken for one
 * chat is valid for all.
 */
export async function trackIdentityEverywhere(
  api: Api,
  userId: number,
  current: Identity,
  exceptChatId?: number,
  source: IdentitySource = "fanout"
): Promise<void> {
  const rows = await userRepository.findAllForUser(userId);
  const chatIds = [...new Set(rows.map((r) => r.chatId))].filter((id) => id !== exceptChatId);
  if (chatIds.length === 0) return;

  const chats = await chatRepository.listByChatIds(chatIds);
  for (const chatConfig of chats) {
    if (chatConfig.isActive === false) continue;
    try {
      await trackIdentity(api, chatConfig, userId, chatConfig.chatId, current, source);
    } catch (err) {
      logger.error({ action: "track_identity_chat", chatId: chatConfig.chatId, userId, error: String(err) });
    }
  }
}
