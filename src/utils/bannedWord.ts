import { BannedWordSeverity, IBannedWord } from "../types";

/**
 * Normalised view of a banned-word rule's enforcement actions.
 * The dashboard now picks any combination of {delete, warn, silence}, plus optional
 * standalone kick / flag. Legacy rows persisted before this refactor only have a
 * single `severity` string, so `resolveActions` expands them to the same shape.
 */
export interface ResolvedBannedWordActions {
  delete: boolean;
  warn: boolean;
  silence: boolean;
  kick: boolean;
  flag: boolean;
  warnReason: string | null;
}

/** Expand a legacy severity string into the multi-action shape. */
export function expandLegacySeverity(severity: BannedWordSeverity): ResolvedBannedWordActions {
  switch (severity) {
    case "flag":
      return { delete: false, warn: false, silence: false, kick: false, flag: true, warnReason: null };
    case "aviso":
      return { delete: false, warn: true, silence: false, kick: false, flag: false, warnReason: null };
    case "borrar":
      return { delete: true, warn: false, silence: false, kick: false, flag: false, warnReason: null };
    case "silenciar":
      // Historical behaviour: silenciar always deleted the message first.
      return { delete: true, warn: false, silence: true, kick: false, flag: false, warnReason: null };
    case "kick":
      return { delete: false, warn: false, silence: false, kick: true, flag: false, warnReason: null };
  }
}

/**
 * Resolve any BannedWord (new shape or legacy `severity`-only row) to a single
 * normalised action map. New fields win when present; otherwise the legacy
 * `severity` field is expanded.
 */
export function resolveActions(word: IBannedWord): ResolvedBannedWordActions {
  const hasNewShape = !!word.actions || word.kick === true || word.flag === true || !!word.warnReason;
  if (hasNewShape) {
    return {
      delete: !!word.actions?.delete,
      warn: !!word.actions?.warn,
      silence: !!word.actions?.silence,
      kick: !!word.kick,
      flag: !!word.flag,
      warnReason: word.warnReason ?? null,
    };
  }
  return expandLegacySeverity(word.severity);
}

/** Pick a single primary severity for the legacy `severity` column on write. */
export function derivePrimarySeverity(actions: {
  delete?: boolean;
  warn?: boolean;
  silence?: boolean;
  kick?: boolean;
  flag?: boolean;
}): BannedWordSeverity {
  if (actions.kick) return "kick";
  if (actions.silence) return "silenciar";
  if (actions.warn) return "aviso";
  if (actions.delete) return "borrar";
  if (actions.flag) return "flag";
  return "flag";
}
