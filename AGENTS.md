# AGENTS.md — YukiBot AI Context (root)

> Lean index for every AI agent. Self-contained overview + pointers to topic files.

## Project

**YukiBot** — Telegram group moderation bot + web dashboard, running as a single Node process.

All code, variable names, and logs are in **English**. User-facing bot strings live in **Spanish** in `src/locales/es.json`.

YukiBot supports **topics-type chats** (forums with per-topic content rules) and **normal chats** (standard groups). Some features are shared across both types; others target administration/log channels.

| Layer      | Tech                                                               |
| ---------- | ------------------------------------------------------------------ |
| Language   | TypeScript / Node.js 20                                            |
| Bot API    | Grammy (grammyjs.com)                                              |
| HTTP / API | Express 4                                                          |
| Web client | React 18 + React Router 6 + Vite 5 (in `web/`)                     |
| Auth       | Telegram Login Widget + username/password (bcryptjs) + JWT         |
| Database   | MongoDB + Mongoose (Atlas M0 free)                                 |
| Deployment | Railway via GitHub auto-deploy (Dockerfile builds both workspaces) |
| Local dev  | nodemon + ts-node (bot) · `npm run dev:web` (Vite dev server)      |

## Source Layout

```
src/
├── index.ts                ← bot + middleware + commands + API server
├── config/index.ts         ← env parsing (BOT_TOKEN, BOT_USERNAME, BOT_LOGIN_DOMAIN,
│                              JWT_SECRET, PORT, ADMIN_IDS, BOT_ENABLED, TOPIC_RULES)
├── types/index.ts          ← enums, Mongoose interfaces, BotContext, activity log types
├── locales/es.json         ← Spanish user-facing strings
├── db/
│   ├── connection.ts
│   ├── models/             ← Chat, Admin, User, Topic, Message, Credential,
│   │                          ActivityLog, BannedWord, SpamPattern, UserDomainAllowance
│   └── repositories/       ← data-access layer (one per entity)
├── bot/
│   ├── commands/           ← one file per command handler
│   ├── handlers/           ← chatMember, mediaForward, spamCallback
│   ├── helpers/            ← resolveTarget, applyWarn, executeSilence,
│   │                          sendAndAutoDelete, sendLog, forwardToLog,
│   │                          profilePhoto, silenceUser, unsilenceUser, html, …
│   └── middleware/         ← loadChat → trackUser → trackTopic → isAdmin → adminOnlyCommands
├── features/
│   ├── topicFiltering/
│   ├── promoSpamDetection/    ← linkAnalyzer + patternMatcher
│   └── bannedWordsEnforcement/← matcher + cache
├── api/
│   ├── server.ts           ← Express app factory (mounted by index.ts)
│   ├── middleware/         ← authenticate (JWT), requireChatAdmin
│   ├── routes/             ← auth, chats, topics, users, whitelist, bannedWords,
│   │                          activityLogs, admins, photos, spamDetections
│   └── services/userActions.ts
├── cli/credentials.ts      ← cred:add / cred:list / cred:rm
└── utils/                  ← logger, activityLog, bannedWord helpers

web/                        ← Vite + React SPA (built into web/dist by `build:web`)
```

## MongoDB Entities (compound unique indexes noted)

| Entity              | Key fields                                                                                                                                          | Unique index         |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| Chat                | chatId, name, type, isActive, whitelist, features, linkWhitelist, spamUserWhitelist, hiddenAdminIds, delegatedOwnerId, logsTo, forwardsTo, logFlags | chatId               |
| Admin               | userId, username, name, chatId, chatName, role (owner \| admin)                                                                                     | userId + chatId      |
| Topic               | chatId, topicId, name, allowedMsgTypes[], adminOnly, isUserConfigured                                                                               | chatId + topicId     |
| User                | userId, chatId, username, name, warnings, warningReasons, isMuted, muteUntil, isBanned, wasBanned, photoFileId                                      | userId + chatId      |
| Message             | userId, chatId, fingerprint, timestamp                                                                                                              | TTL 48 h auto-delete |
| Credential          | username, passwordHash, userId, name                                                                                                                | username             |
| SpamPattern         | chatId, pattern, fingerprint, learnedBy, createdAt                                                                                                  | per-chat patterns    |
| BannedWord          | chatId, word, severity, actions, kick, flag, exactMatch, scope, topicId                                                                             | per chat or topic    |
| UserDomainAllowance | chatId, userId, domains                                                                                                                             | chatId + userId      |
| ActivityLog         | chatId, type, source, actorId, targetId, timestamp                                                                                                  | TTL 90 days          |

## Middleware Order (critical)

```
loadChat → trackUser → trackTopic → isAdmin → adminOnlyCommands → feature handlers
```

`/setup` bypasses whitelist and `adminOnlyCommands`.

## Process Topology

- A **single Node process** runs Grammy long-polling **and** the Express API + static SPA.
- `BOT_ENABLED=false` keeps the API up but skips bot polling — useful for local web work and migrations.
- `src/api/server.ts` mounts:
  - `GET /health`
  - `GET /api/public/config` → `{ botUsername, botLoginDomain }`
  - `POST /api/auth/...` → Telegram-widget + username/password login
  - `/api/chats`, `/api/chats/:chatId/{topics,users,whitelist,banned-words,logs,admins,spam-detections}`
  - `/api/photos`
  - Static `web/dist/` + SPA fallback for React Router.

## Guardrails 🛑

| #   | Rule                                                                                                                                                                                                                                                                                                                                                               |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| G1  | NEVER commit `BOT_TOKEN`, `MONGODB_URI`, or `JWT_SECRET`                                                                                                                                                                                                                                                                                                           |
| G2  | NEVER hardcode chatIds, userIds, or credentials in source code                                                                                                                                                                                                                                                                                                     |
| G3  | NEVER set `wasBanned` back to `false`                                                                                                                                                                                                                                                                                                                              |
| G4  | NEVER remove the admin-bypass check — bot must not touch admin msgs                                                                                                                                                                                                                                                                                                |
| G5  | NEVER leave a moderation notice visible in a group chat — `ban` / `auto-ban` / `silence` confirmations are sent then **immediately deleted**; only the warn `1/3`·`2/3` notices may persist. The audit trail lives in the log channel + dashboard, not the group.                                                                                                  |
| G6  | `/setup` MUST always bypass whitelist + adminOnlyCommands middleware                                                                                                                                                                                                                                                                                               |
| G7  | All new commands MUST be added to the `adminOnlyCommands` protected list                                                                                                                                                                                                                                                                                           |
| G8  | All new features MUST have a feature flag defaulting to `false`                                                                                                                                                                                                                                                                                                    |
| G9  | All DB calls wrapped in try/catch — bot never crashes from MongoDB                                                                                                                                                                                                                                                                                                 |
| G10 | Errors logged with tags, never sent to group chat (silent failures)                                                                                                                                                                                                                                                                                                |
| G11 | No `console.log` left in committed code — use the structured `logger` from `src/utils/logger.ts`                                                                                                                                                                                                                                                                   |
| G12 | Comments must explain **why**, not restate what the code says — omit obvious comments entirely. Keep them **short and rare**: one terse line, never a 3+ line essay, and don't annotate every block                                                                                                                                                                    |
| G13 | Every change must pass `tsc --noEmit`, `npm run format:check`, `npm run lint`, and `npm test` before being considered done                                                                                                                                                                                                                                         |
| G14 | NEVER re-implement a capability the bot already has — reuse the shared helper. Log-channel posts go through `sendLog`, dashboard records through `recordActivity`, warnings through `applyWarn`, joins through `handleUserJoin`. The web panel calls the same helpers (`userActions.ts`); it never duplicates a bot flow.                                          |
| G15 | Before merging a PR: the branch has **no merge conflicts** with `main` AND CI is **green on the PR's latest commit** (`gh pr checks`). A green local run is not enough — `main` auto-deploys to Railway, so a red merge is a production outage. See [docs/agents/pull-requests.md](docs/agents/pull-requests.md#remote-verification-do-not-merge-until-both-pass). |
| G16 | **Feature isolation — turning feature B off MUST NEVER disable feature A.** A flag switches only its own feature. When one handler serves several features (e.g. `csamBioTrigger` fires for `csamDetection` *and* `languageDetection`), gate each feature's behaviour on that feature's **own** flag and let each degrade independently. Piggy-backing on an existing handler to avoid duplication is allowed **only** while every rider stays independently switchable — prove it by toggling each flag alone. See the Feature Flags table for the shared-handler map. |
| G17 | **One canonical derivation per stored field.** A value derived from input and persisted (e.g. a user's display name from `first_name`/`last_name`) is produced by **one** shared function, used by every writer **and** every comparator. Two paths computing "the same" value differently manufacture phantom diffs — the name tracker announced fake profile changes because `trackUser` stored `first_name` while `trackIdentity` compared `first_name + " " + last_name`. |
| G18 | **Strict pre-merge review for feature coupling.** Bundling several features in one PR is fine (#39 shipped CSAM + the name tracker + a language exemption — allowed). Features *depending on* each other is **not**. Every PR gets a review that names each feature flag the diff touches and **verifies each toggles independently** — turning one off must never disable another (G16). Don't assume isolation; check it. |

## Environment Variables

| Var                | Source / purpose                                                  |
| ------------------ | ----------------------------------------------------------------- |
| `BOT_TOKEN`        | BotFather                                                         |
| `BOT_USERNAME`     | Bot username without `@` — required for the Telegram Login Widget |
| `BOT_LOGIN_DOMAIN` | Domain registered via BotFather `/setdomain` (e.g. `yukibot.dev`) |
| `MONGODB_URI`      | MongoDB Atlas                                                     |
| `JWT_SECRET`       | 32+ char secret used to sign dashboard JWTs                       |
| `ADMIN_IDS`        | Comma-separated Telegram IDs that get super-admin (all chats)     |
| `PORT`             | HTTP port (default 3000; Railway injects automatically)           |
| `BOT_ENABLED`      | `"false"` runs the API only — skips bot polling                   |
| `TOPIC_RULES`      | Legacy static topic rule JSON; DB rules take precedence           |

## Commands (all admin-only, Spanish UI)

Registered in `src/index.ts` and protected by `adminOnlyCommands` (G7). Only the short forms below exist — older long aliases (`/avisar`, `/quitaraviso`, `/avisos`, `/perdonarban`, `/pban`) have been removed.

### Warnings

| Command | Description                       |
| ------- | --------------------------------- |
| `/av`   | Warn user (max 3 → auto-ban at 3) |
| `/elav` | Delete replied message + warn     |
| `/qav`  | Remove last warning               |
| `/avs`  | Check warning count               |

### Silence

| Command    | Description                             |
| ---------- | --------------------------------------- |
| `/sil`     | Silence 1 week                          |
| `/elsil`   | Delete replied message + silence        |
| `/silav`   | Silence + warn                          |
| `/elsilav` | Delete replied message + silence + warn |
| `/qsil`    | Unsilence user                          |
| `/qsilav`  | Unsilence + remove last warning         |

### Kicks & bans

| Command | Description                                             |
| ------- | ------------------------------------------------------- |
| `/kk`   | Kick (user can rejoin)                                  |
| `/bn`   | Ban permanently — sets `wasBanned`, triggers auto-reban |
| `/qban` | Pardon — delete user DB record + unban                  |

### Anti-spam

| Command                         | Description                                                      |
| ------------------------------- | ---------------------------------------------------------------- |
| `/spam`                         | Reply to a message → delete + silence + warn + learn the pattern |
| `/nospam`                       | Remove a learned pattern by pattern ID or user ID                |
| `/wladd` / `/wldel` / `/wls`    | Manage the per-chat link whitelist                               |
| `/wluadd` / `/wludel` / `/wlus` | Manage the per-chat spam-detection user whitelist                |

### Configuration (owner only)

| Command          | Description                                         |
| ---------------- | --------------------------------------------------- |
| `/setup`         | Initialize chat (creator only — bypasses whitelist) |
| `/addtopic`      | Add topic content rules (topics chats only)         |
| `/edittopic`     | Edit topic rules                                    |
| `/removetopic`   | Remove topic rules                                  |
| `/togglefeature` | Toggle a feature flag                               |

### Help

| Command | Description                               |
| ------- | ----------------------------------------- |
| `/com`  | Show the full command list (auto-deletes) |

## Feature Flags (`Chat.features`, default `false` — G8)

Toggle via `/togglefeature` (owner), the dashboard Features screen (`PUT /:chatId/features` → `patchFeatures`, a **per-key `$set`** that never clobbers other flags), or Compass. Every flag is **independently switchable (G16)** — turning one off never disables another. Keep this table in sync when adding a flag; it is the blast-radius map.

| Flag                     | Description                                                                                | Gated entry points                                                                                                     |
| ------------------------ | ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `topicFiltering`         | Per-topic message-type enforcement (deletes content that doesn't match `allowedMsgTypes`) | `topicFiltering` message handler                                                                                     |
| `autoBan`                | Auto-reban users with `wasBanned: true` on rejoin                                         | join / `chatMember` handler                                                                                          |
| `autoWarnSpam`           | Auto-warn when spam is detected by Group Help bot (legacy)                                | spam callback handler                                                                                                |
| `promoSpamDetection`     | Heuristic link analysis + learned patterns (`/spam` to teach, `/nospam` to forget)        | `promoSpamDetection` message handler                                                                                 |
| `bannedWordsEnforcement` | Enforce `BannedWord` rules (delete/warn/silence/kick)                                     | `bannedWordsEnforcement` message handler                                                                             |
| `welcomeMessage`         | Greet new joiners                                                                         | join / welcome handler                                                                                               |
| `csamDetection`          | CSAM/impostor detection (**CP_ALERTA**) — bio + image                                     | **3 paths:** `csamBioTrigger` (urgent bio queue) · `csamImageScan` (image OCR) · rolling `scanner` (bio sweep)      |
| `languageDetection`      | Off-language warnings (AI classifier, grace/escalation)                                    | `languageDetection` message handler · **also** `csamBioTrigger` (recent-message recording for bulk-delete)          |
| `trackNameChanges`       | SangMata-style name/@username change notices                                              | `nameChangeTracker` message handler **only** — shares no runtime path with CSAM                                     |

**Shared handlers (read before touching one):** `csamBioTrigger` fires when `csamDetection` **or** `languageDetection` is on and records recent messages for either — each branch gates on its own flag, so one being off never breaks the other (G16). `trackNameChanges` is a **separate** handler that does not gate or feed any CSAM path: disabling it cannot disable CP_ALERTA. When you edit a shared handler, re-verify every flag in its row.

## Scratch Memory (`.scratch/memory/` — gitignored)

**Every session starts by reading `.scratch/memory/INDEX.md`** (absent on a fresh clone — that just means nothing to resume). It indexes the open **threads**: one small markdown file per effort in flight, holding that effort's decisions, rejected options, constraints, and next step — the _why_ that neither the diff nor a compacted context window keeps.

This is the single point of truth for work being discussed but not yet shipped, shared by every agent and tool driving this repo. It exists so that a compaction, a reboot, a model switch, or a jump to another CLI costs no decisions and no re-prompting — the human types "continue" and the agent knows where things stand.

The agent maintains it **unprompted**: capture each decision as it lands, archive a thread once its PR merges, purge archives after 7 days, and ask before dropping a live thread untouched for 7 days. Full protocol and file templates: [.agents/skills/scratch-memory/SKILL.md](.agents/skills/scratch-memory/SKILL.md).

## Skills (`.agents/skills/`)

Reusable agent procedures, installed once as a single canonical copy — **no per-agent duplication**. Regardless of which tool is driving (Claude Code, Copilot CLI, …), read the linked `SKILL.md` when its trigger matches the current task.

**Claude Code setup note:** Claude Code only auto-discovers skills under `.claude/skills/`, not `.agents/skills/`. On a fresh clone (or new machine), bridge them with a per-skill directory junction so Claude Code can see them without duplicating content:

```powershell
Get-ChildItem ".agents\skills" -Directory | ForEach-Object {
  New-Item -ItemType Junction -Path ".claude\skills\$($_.Name)" -Target $_.FullName
}
```

`.claude/skills/` is gitignored (machine-local junctions, not tracked content).

| Skill                      | Path                                                | When to use                                                                     |
| -------------------------- | ---------------------------------------------------- | -------------------------------------------------------------------------------- |
| `setup-matt-pocock-skills` | `.agents/skills/setup-matt-pocock-skills/SKILL.md`  | One-time config (issue tracker, triage labels, domain docs) — run before others |
| `tdd`                      | `.agents/skills/tdd/SKILL.md`                       | Building a feature or fixing a bug test-first (red-green-refactor)              |
| `code-review`              | `.agents/skills/code-review/SKILL.md`               | Reviewing a diff/PR/branch against coding standards + the originating spec      |
| `codebase-design`          | `.agents/skills/codebase-design/SKILL.md`           | Designing/improving a module's interface, finding "deepening" opportunities     |
| `grill-me`                 | `.agents/skills/grill-me/SKILL.md`                  | Interviewing the user to sharpen a plan/design before implementing             |
| `handoff`                  | `.agents/skills/handoff/SKILL.md`                   | Compacting the current session into a handoff doc for another agent            |
| `wayfinder`                | `.agents/skills/wayfinder/SKILL.md`                 | Planning multi-session work as a shared map of decision tickets                |
| `writing-great-skills`     | `.agents/skills/writing-great-skills/SKILL.md`      | Reference for writing/editing skills predictably                               |
| `caveman`                  | `.agents/skills/caveman/SKILL.md`                   | Terse/compressed responses on request ("caveman mode", `/caveman`)             |
| `scratch-memory`           | `.agents/skills/scratch-memory/SKILL.md`            | Persisting/resuming decisions of work in flight — fires automatically every session |

## Topic Files

| File                                                                                     | Scope                                                   |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| [.github/copilot-instructions.md](.github/copilot-instructions.md)                       | Always-on Copilot guardrails                            |
| [.github/instructions/coding-conventions.md](.github/instructions/coding-conventions.md) | TS conventions, components, log tags, commenting        |
| [.github/instructions/yukibot-workflow.md](.github/instructions/yukibot-workflow.md)     | Middleware, feature flags, command patterns             |
| [.github/git-commit-instructions.md](.github/git-commit-instructions.md)                 | Commit format                                           |
| [docs/agents/developer-workflows.md](docs/agents/developer-workflows.md)                 | npm scripts, Railway, local dev, MongoDB, dashboard CLI |
| [docs/agents/pull-requests.md](docs/agents/pull-requests.md)                             | PRs, branches, review, merge rules                      |
| [docs/architecture.md](docs/architecture.md)                                             | Mermaid diagrams + data model                           |
| [CLAUDE.md](CLAUDE.md)                                                                   | Compact Claude-specific context                         |
