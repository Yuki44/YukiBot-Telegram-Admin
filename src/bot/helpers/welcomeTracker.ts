import { WELCOME_DEDUP_TTL_MS } from "../../config/constants";

/**
 * Short-lived, in-memory "this user was just welcomed" guard.
 *
 * The welcome is meant to fire on *every* entry to the group — a user who
 * leaves and comes back should be greeted again. So we deliberately do NOT
 * persist a once-ever flag. The only thing we must suppress is a double
 * greeting for the *same* entry, which happens because one join produces up to
 * two updates (`chat_member` + `new_chat_members`) within the same moment, and
 * Telegram can redeliver an unconfirmed update. A small TTL window keyed by
 * (chatId, userId) collapses exactly those into a single greeting while leaving
 * any later re-entry free to greet again.
 *
 * `claimRecentWelcome` is fully synchronous (check-then-set with no `await`
 * between), so under N concurrent joins for the same user exactly one caller
 * gets `true` — the JS event loop guarantees the atomicity a DB conditional
 * update used to provide.
 */
const recent = new Set<string>();

function key(chatId: number, userId: number): string {
  return `${chatId}:${userId}`;
}

/** Returns true for the first caller within the TTL window; false thereafter. */
export function claimRecentWelcome(chatId: number, userId: number): boolean {
  const k = key(chatId, userId);
  if (recent.has(k)) return false;
  recent.add(k);
  const t = setTimeout(() => recent.delete(k), WELCOME_DEDUP_TTL_MS);
  // Don't keep the process (or a test run) alive just for this timer.
  t.unref?.();
  return true;
}

/**
 * Drop the guard immediately. Called when the welcome send failed (so the next
 * update can retry) and when the user is observed leaving/kicked (so an
 * immediate, detected re-entry is greeted without waiting out the TTL).
 */
export function clearRecentWelcome(chatId: number, userId: number): void {
  recent.delete(key(chatId, userId));
}

/** Test-only: wipe all state between cases. */
export function resetWelcomeTracker(): void {
  recent.clear();
}
