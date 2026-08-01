/**
 * Shared HTML-escaping and display helpers for Telegram HTML messages.
 * Every module that builds HTML strings should import from here — never duplicate.
 */

/** Escape user-provided text for safe embedding in Telegram HTML. */
export function esc(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Formatted display name: "Name (@username)" or just "Name". */
export function displayName(name: string, username?: string): string {
  return username ? `${esc(name)} (@${esc(username)})` : esc(name);
}

/** Mention string: "@username" if available, otherwise the raw name. */
export function mention(name: string, username?: string): string {
  return username ? `@${username}` : name;
}

/**
 * Always-clickable mention: wraps the display text in a `tg://user?id=` link so it
 * opens the user's profile even when they have no public @username (plain `@username`
 * text only auto-links when Telegram can resolve a username — a bare name never does).
 */
export function mentionHtml(id: number, name: string, username?: string): string {
  const label = username ? `@${username}` : esc(name);
  return `<a href="tg://user?id=${id}">${label}</a>`;
}

/** Profile link with explicit display text (unlike mentionHtml, never swaps in @username). */
export function profileLink(id: number, label: string): string {
  return `<a href="tg://user?id=${id}">${esc(label)}</a>`;
}

/**
 * Canonical mention for user-facing notices: clickable full name plus the clickable
 * `(@username)` when there is one. `idFallback` adds a tap-to-copy `(id)` instead when
 * the user has no username — used in admin notifications where the ID is actionable.
 */
export function mentionFullHtml(
  id: number,
  name: string,
  username?: string,
  options?: { idFallback?: boolean }
): string {
  const link = profileLink(id, name);
  if (username) return `${link} (<a href="tg://user?id=${id}">@${esc(username)}</a>)`;
  return options?.idFallback ? `${link} (<code>${id}</code>)` : link;
}
