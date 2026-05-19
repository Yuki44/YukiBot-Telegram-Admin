/**
 * Normalize a user-typed link into a valid http/https URL.
 *
 * - Bare input ("t.me/canal", "example.com") gets `https://` prepended so the
 *   admin never has to type the scheme.
 * - An explicit http/https scheme is kept and validated.
 * - Any other scheme ("tg:", "javascript:", "ftp:", …) is rejected.
 *
 * Returns the canonical URL string, or `null` when the input can't be made
 * into a valid http/https URL (caller decides how to surface that).
 */
export function normalizeHttpUrl(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;

  const schemeMatch = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(s);
  let candidate: string;
  if (schemeMatch) {
    const scheme = schemeMatch[1].toLowerCase();
    if (scheme !== "http" && scheme !== "https") return null;
    candidate = s;
  } else {
    candidate = `https://${s}`;
  }

  try {
    const u = new URL(candidate);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    if (!u.hostname) return null;
    return u.toString();
  } catch {
    return null;
  }
}
