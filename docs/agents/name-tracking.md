# Name / identity tracking — rationale

Background for the rules in [AGENTS.md](../../AGENTS.md). Read before changing `src/features/nameTracking/`,
`src/bot/handlers/nameChangeTracker.ts`, or `src/bot/helpers/html.ts`.

## Per-chat comparison, cross-chat reads

Each chat compares an observation against its **own** `User` row and writes only that row
(`confirmIdentity`), so one profile edit produces one notice per chat. A single _read_, however, is
applied to every chat the user belongs to (`trackIdentityEverywhere`): name and @username are global
on Telegram, so both the bio rotation and a message revealing a change fan the same observation out.
Without the fan-out, a change seen in one group never reached the other. Only the avatar is shared
(`syncPhotoAcrossChats`), and it is never announced.

## The identity write belongs to `nameChangeTracker`, not `trackUser`

The membership middleware used to `$set` the name first, so the comparison right after it found
nothing to announce — one lost change per user after every restart. `findOrCreate` now only
`$setOnInsert`s identity, so no caller (including `resolveTarget`'s cached admin name) can overwrite
the baseline. `handleJoin` also tracks identity, catching a rename that happened while the user was
away.

## Unverified baselines

A row carries `identityConfirmedAt`; until it is set the stored name is an unverified leftover, so
the first reading is adopted **silently**. That baseline is what keeps a newly-readable population
(the `getChatMember` probe made ~82% of members legible for the first time) from announcing months
of accumulated drift at once, as happened on 2026-08-02.

## Rendering rules and why they exist

- **Invisible names.** Soft hyphens and Hangul fillers are stripped for comparison; a name made only
  of variation selectors or ZWJ renders blank on screen and is shown as `(nombre invisible)`. When
  such a name did not change, the notice drops it and reports the handle alone — otherwise both
  halves of the message were spent on a name nobody can see.
- **Link target.** `https://t.me/<handle>` resolves for every viewer; `tg://user?id=` only resolves
  for peers the viewer's client already knows, so it was dead in the log channel. The numeric id
  stays tap-to-copy as the permanent fallback. The choice lives in **one** place, `profileHref` in
  `src/bot/helpers/html.ts` (G17), and every mention the bot writes — notices, admin alerts, and the
  welcome message — goes through it.
- **Replaced handles.** Rendered `<i>@⁠handle</i>` with a word joiner after the `@`: visible as
  `@handle` yet never a link, since Telegram auto-links any bare `@handle` to whoever holds it now
  and a freed handle may belong to a stranger. The empty/removed marker reads "vacío" for the same
  reason. Every notice starts with the tap-to-copy `<code>id</code>`.

## Trails

Every announced change is written to `ActivityLog` as `name_change`, giving the dashboard a
queryable record. The `identityObservations` flag adds a 14-day TTL'd trail of every _reading_
(source + outcome), which is what separates "we never saw it" from "we saw it and stayed silent".
