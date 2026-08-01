/** Mirror of src/utils/url.ts — a bare "t.me/x" is accepted; non-http(s) is not. */
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
