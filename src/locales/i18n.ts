/**
 * Internationalisation (i18n) module.
 *
 * Loads user-facing strings from JSON locale files so that:
 * 1. All presentation text lives in one place (single source of truth).
 * 2. Adding a new language only requires a new JSON file — zero code changes.
 *
 * Usage:
 *   import { t } from "../locales/i18n";
 *   t("warnings.warnNotice", { current: 1, max: 3, user: dn, reason })
 */

import es from "./es.json";

type Locale = typeof es;

const locales: Record<string, Locale> = { es };

/** Current active locale. Defaults to Spanish per project rules. */
const ACTIVE_LOCALE = "es";

/**
 * Resolve a dotted key path like "errors.userNotFound" to the string value
 * in the active locale file.
 */
function resolve(key: string): string {
  const parts = key.split(".");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let node: any = locales[ACTIVE_LOCALE];
  for (const part of parts) {
    if (node === undefined || node === null) return key;
    node = node[part];
  }
  return typeof node === "string" ? node : key;
}

/**
 * Translate a key, optionally replacing `{placeholder}` tokens.
 *
 * @example
 * t("warnings.warnNotice", { current: 1, max: 3, user: "John", reason: "spam" })
 * // → "⚠️ <b>Aviso 1/3</b> para John\n📋 Razón: spam"
 */
export function t(key: string, params?: Record<string, string | number>): string {
  let text = resolve(key);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      text = text.replace(new RegExp(`\\{${k}\\}`, "g"), String(v));
    }
  }
  return text;
}

