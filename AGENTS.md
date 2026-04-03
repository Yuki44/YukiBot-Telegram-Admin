# AGENTS.md — YukiBot AI Context (root)

> Lean index for every AI agent. Self-contained overview + pointers to topic files.

## Project

**YukiBot** — Telegram group moderation bot.

All code, variable names, and logs are in **English**. User-facing bot messages in group chats are in **Spanish**.

YukiBot supports **topics-type chats** (forums with per-topic content rules) and **normal chats** (standard groups). Some features are shared across both types, while others are specific to administration/log channels.

| Layer        | Tech                                      |
| ------------ | ----------------------------------------- |
| Language     | TypeScript / Node.js                      |
| Bot API      | Grammy (grammyjs.com)                     |
| Database     | MongoDB + Mongoose (Atlas M0 free)        |
| Deployment   | Railway via GitHub auto-deploy            |
| Local dev    | nodemon + ts-node                         |

## Source Layout

```
src/
├── index.ts              ← entry point, middleware + command registration
├── config/index.ts       ← env parsing (BOT_ENABLED, ADMIN_IDS, TOPIC_RULES)
├── types/index.ts        ← enums, Mongoose doc interfaces, BotContext
├── db/
│   ├── connection.ts
│   ├── models/           ← Mongoose schemas
│   └── repositories/     ← data-access layer (one per entity)
├── bot/
│   ├── commands/         ← one file per command handler
│   ├── handlers/         ← event handlers (chat_member, media forward)
│   ├── helpers/          ← shared helpers (resolveTarget, applyWarn, sendAndAutoDelete, silenceUser, unsilenceUser)
│   └── middleware/       ← loadChat → trackUser → isAdmin → adminOnlyCommands
├── features/             ← feature-flag-gated logic (topicFiltering, …)
└── utils/logger.ts
```

## MongoDB Entities (compound unique indexes noted)

| Entity  | Key fields                                                                 | Unique index          |
| ------- | -------------------------------------------------------------------------- | --------------------- |
| Chat    | chatId, name, type, isActive, whitelist, features{…}, forwardsTo?, logsTo? | chatId                |
| Admin   | userId, username, name, chatId, chatName, role (owner\|admin)              | userId + chatId       |
| Topic   | chatId, topicId, name, allowedMsgTypes[]                                   | chatId + topicId      |
| User    | userId, chatId, username, warnings, isMuted, muteUntil, isBanned, wasBanned | userId + chatId     |
| Message | userId, chatId, fingerprint, timestamp                                     | TTL 48 h auto-delete  |

## Middleware Order (critical)

```
loadChat → trackUser → isAdmin → adminOnlyCommands → feature handlers
```

`/setup` bypasses whitelist and adminOnlyCommands.

## Guardrails 🛑

| #  | Rule                                                                 |
| -- | -------------------------------------------------------------------- |
| G1 | NEVER commit `BOT_TOKEN` or `MONGODB_URI`                           |
| G2 | NEVER hardcode chatIds, userIds, or credentials in source code       |
| G3 | NEVER set `wasBanned` back to `false`                                |
| G4 | NEVER remove the admin-bypass check — bot must not touch admin msgs  |
| G5 | NEVER send messages to group chats except: warn, auto-reban, silence (auto-deletes after 1 s) |
| G6 | `/setup` MUST always bypass whitelist + adminOnlyCommands middleware  |
| G7 | All new commands MUST be added to the adminOnlyCommands protected list |
| G8 | All new features MUST have a feature flag defaulting to `false`      |
| G9 | All DB calls wrapped in try/catch — bot never crashes from MongoDB   |
| G10| Errors logged with tags, never sent to group chat (silent failures)  |
| G11| No `console.log` left in committed code (use tagged `console.error` for errors only) |

## Environment Variables

| Var           | Source        |
| ------------- | ------------- |
| `BOT_TOKEN`   | BotFather     |
| `MONGODB_URI` | MongoDB Atlas |
| `BOT_ENABLED` | optional      |
| `ADMIN_IDS`   | comma-sep IDs |

## Commands (all admin-only, Spanish UI)

| Command         | Alias   | Description                                      |
| --------------- | ------- | ------------------------------------------------ |
| /setup          |         | Initialize chat (owner/creator only)             |
| /addtopic       |         | Add topic content rules (topics chats only)      |
| /edittopic      |         | Edit topic rules                                 |
| /removetopic    |         | Remove topic rules                               |
| /togglefeature  |         | Toggle feature flag (owner only)                 |
| /avisar         | /av     | Warn user (max 3, auto-ban at 3)                 |
| /quitaraviso    | /qav    | Remove one warning                               |
| /avisos         | /avs    | Check warning count                              |
| /perdonarban    | /pban   | Full pardon — deletes user DB record entirely    |
| /sil            |         | Silence 1 week                                   |
| /elsil          |         | Delete replied message + silence                 |
| /silav          |         | Silence + warn                                   |
| /elsilav        |         | Delete replied message + silence + warn          |
| /qsil           |         | Unsilence user                                   |
| /com            |         | Check user info                                  |

## Topic Files

| File                                           | Scope                                          |
| ---------------------------------------------- | ---------------------------------------------- |
| [.github/copilot-instructions.md](.github/copilot-instructions.md) | Always-on Copilot guardrails          |
| [.github/instructions/coding-conventions.md](.github/instructions/coding-conventions.md) | TS conventions, components, log tags, commenting |
| [.github/instructions/yukibot-workflow.md](.github/instructions/yukibot-workflow.md) | Middleware, feature flags, command patterns     |
| [.github/git-commit-instructions.md](.github/git-commit-instructions.md) | Commit format                                  |
| [docs/agents/developer-workflows.md](docs/agents/developer-workflows.md) | npm scripts, Railway, local dev, MongoDB setup |
| [docs/agents/pull-requests.md](docs/agents/pull-requests.md) | PRs, branches, review, merge rules             |
| [CLAUDE.md](CLAUDE.md)                         | Compact Claude-specific context                |

