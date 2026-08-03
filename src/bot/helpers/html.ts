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
 * `https://t.me/<handle>` resolves for any viewer; `tg://user?id=` only for peers the viewer's
 * client already knows — dead in a log channel. Only the *current* handle may be used: a freed
 * one now points at whoever registered it next. The charset test guards href injection.
 */
export function profileHref(id: number, currentUsername?: string): string {
  return currentUsername && /^[A-Za-z0-9_]+$/.test(currentUsername)
    ? `https://t.me/${currentUsername}`
    : `tg://user?id=${id}`;
}

/** Clickable even without a public @username, which bare text never is. */
export function mentionHtml(id: number, name: string, username?: string): string {
  const label = username ? `@${username}` : esc(name);
  return `<a href="${profileHref(id, username)}">${label}</a>`;
}

/** Profile link with explicit display text (unlike mentionHtml, never swaps in @username). */
export function profileLink(id: number, label: string, currentUsername?: string): string {
  return `<a href="${profileHref(id, currentUsername)}">${esc(label)}</a>`;
}

/**
 * Canonical mention for user-facing notices. `idFallback` adds a tap-to-copy id when there is
 * no username — for admin notifications where the id is actionable.
 */
export function mentionFullHtml(
  id: number,
  name: string,
  username?: string,
  options?: { idFallback?: boolean }
): string {
  const link = profileLink(id, name, username);
  if (username) return `${link} (<a href="${profileHref(id, username)}">@${esc(username)}</a>)`;
  return options?.idFallback ? `${link} (<code>${id}</code>)` : link;
}
