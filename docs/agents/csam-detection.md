# CSAM detection & identity coverage — rationale

Background for the flag table in [AGENTS.md](../../AGENTS.md). Read before touching
`src/features/csamDetection/` or `csamBioTrigger`.

## Three paths, one alert

CSAM/impostor detection (**CP_ALERTA**) runs from three entry points: `csamBioTrigger` (urgent bio
queue), `csamImageScan` (image OCR) and the rolling `scanner` (bio sweep). They share one alert:
`sendCsamAlert` claims `User.csamAlertedAt` per chat, so a post caught by the image tier _and_ the
bio scan raises a single CP_ALERTA. An escalation to AUTO_BAN always alerts.

## Why the presence probe exists

`getChat` only resolves peers the bot has seen recently — roughly 88% of calls fail with
`chat not found` — so the bio rotation gives **no** lurker coverage on its own. Coverage comes from
the `getChatMember` presence probe the scanner fires after `CSAM_SCAN_MISS_LIMIT` consecutive
`getChat` misses: it resolves any member and also prunes rows of users who have left.

## Shared handler, independent flags

`csamBioTrigger` fires when `csamDetection` **or** `languageDetection` is on and records recent
messages for either; each branch gates on its own flag, so one being off never breaks the other
(G16). The rotation feeds every identity it reads to `trackIdentityEverywhere`, which announces per
chat on that chat's own `trackNameChanges`: with `csamDetection` off, `nameChangeTracker` still
announces changes from messages, and disabling `trackNameChanges` cannot disable CP_ALERTA.
