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
