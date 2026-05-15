# YukiBot — Telegram Group Moderation Bot + Web Dashboard

> A TypeScript moderation bot for Telegram groups (Grammy) with topic-scoped filtering, multi-tier warnings, anti-spam detection, banned-word enforcement, and full audit logging — paired with a React/Express web dashboard for owners and admins.

[![CI](https://github.com/Yuki44/YukiBot-Telegram-Admin/actions/workflows/ci.yml/badge.svg)](https://github.com/Yuki44/YukiBot-Telegram-Admin/actions)

---

## Table of Contents

- [Features](#features)
- [Architecture](#architecture)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Getting Started](#getting-started)
- [Environment Variables](#environment-variables)
- [Commands Reference](#commands-reference)
- [Web Dashboard](#web-dashboard)
- [Middleware Pipeline](#middleware-pipeline)
- [Feature Flags](#feature-flags)
- [Database Schema](#database-schema)
- [Testing](#testing)
- [Deployment](#deployment)
- [Design Decisions](#design-decisions)
- [Guardrails](#guardrails)

---

## Features

### Moderation

- **Multi-tier warning system** — 1/3 → 2/3 → 3/3 automatic ban with reasons and audit trail
- **Topic-scoped content filtering** — per-topic rules for message types (photo, video, text, etc.) in forum-style chats
- **Silence / Unsilence** — restrict users for 1 week with Telegram API verification
- **Kick / Ban / Pardon** — full moderation lifecycle (`/kk`, `/bn`, `/qban`) with permanent `wasBanned` flag
- **Auto-reban** — users with `wasBanned: true` are automatically re-banned on rejoin
- **Media forwarding** — automatically forward photos/videos to a collection channel

### Anti-spam

- **Promo-spam detection** — heuristic link analysis with learned patterns (`/spam` to teach, `/nospam` to forget)
- **Per-chat link whitelist** — `/wladd`, `/wldel`, `/wls`
- **Per-user spam-detection whitelist** — `/wluadd`, `/wludel`, `/wlus`
- **Self-chat link allowance** — `t.me` links pointing back to the same chat are ignored

### Words & topics

- **Banned-word enforcement** — chat-wide or per-topic word/phrase rules with configurable actions (delete, warn, silence, kick, flag)
- **Topic auto-discovery** — newly created forum topics are tracked automatically and treated as "allow everything" until an owner explicitly configures them in the dashboard

### Observability

- **Audit logging to Telegram** — every moderation action goes to a dedicated log channel with deep links (gated per-action via `logFlags`)
- **Activity log collection** — additive 90-day queryable history surfaced by the dashboard's "Registro" screen
- **Ephemeral messages** — bot confirmations auto-delete to keep the chat clean
- **Structured JSON logger** — all logs emitted as machine-parseable JSON with `action` tags (no `console.log`)
- **Spanish i18n bundle** — user-facing strings live in `src/locales/es.json`

### Dashboard

- **Express + Vite/React SPA** served from the same process as the bot
- **Telegram Login Widget** + username/password fallback via the CLI-managed credential store
- **Per-chat admin view** of users, topics, banned words, whitelists, activity log, and feature flags
- **Owner delegation** — chat creators can delegate YukiBot owner powers to another admin
- **PWA install banner** — installable on mobile

---

## Architecture

```
┌────────────────────────────────────────────────────────────┐
│                     Telegram Bot API                        │
└──────────────────────┬─────────────────────────────────────┘
                       │
                       ▼
┌────────────────────────────────────────────────────────────┐
│            Single Node.js process (Railway)                 │
│                                                             │
│  ┌──────────────────────┐    ┌─────────────────────────┐   │
│  │   Grammy Bot          │    │   Express API + SPA      │   │
│  │   (long polling)      │    │   (web dashboard)        │   │
│  └─────────┬────────────┘    └─────────┬───────────────┘   │
│            │                            │                    │
│            ▼                            ▼                    │
│  ┌────────────────────────────────────────────────────┐    │
│  │   Middleware pipeline (bot side)                    │    │
│  │   loadChat → trackUser → trackTopic → isAdmin       │    │
│  │   → adminOnlyCommands                              │    │
│  └─────────┬──────────────────────────────────────────┘    │
│            │                                                 │
│  ┌─────────▼──────────┐  ┌──────────────┐  ┌────────────┐ │
│  │  Commands           │  │  Handlers     │  │  Features   │ │
│  │  (bot/commands)     │  │  (bot/handlers│  │  (features) │ │
│  │                     │  │   chat_member,│  │  topicFilter│ │
│  │                     │  │   media, spam │  │  promoSpam  │ │
│  │                     │  │   callback)   │  │  bannedWords│ │
│  └─────────┬──────────┘  └──────┬───────┘  └─────┬──────┘ │
│            └──────────┬─────────┴──────────────────┘        │
│                       ▼                                      │
│  ┌────────────────────────────────────────────────────┐    │
│  │   Shared helpers                                    │    │
│  │   resolveTarget · applyWarn · executeSilence        │    │
│  │   sendAndAutoDelete · sendLog · forwardToLog        │    │
│  │   profilePhoto · html · contextHelpers              │    │
│  └────────────────────────┬───────────────────────────┘    │
│                           ▼                                  │
│  ┌────────────────────────────────────────────────────┐    │
│  │   Repositories (DAL)                                │    │
│  │   chat · admin · user · topic · message · spamPattern│   │
│  │   bannedWord · activityLog · credential · userDomain │   │
│  └────────────────────────┬───────────────────────────┘    │
└───────────────────────────┼──────────────────────────────────┘
                            ▼
┌────────────────────────────────────────────────────────────┐
│             MongoDB Atlas (Mongoose ODM)                    │
└────────────────────────────────────────────────────────────┘
```

### Key Patterns

| Pattern | Description |
|---------|-------------|
| **Repository** | All DB access goes through `src/db/repositories/` — no direct model calls from commands, middleware, or API routes |
| **Middleware chain** | Ordered pipeline enriches `BotContext` with `chatConfig` and `isAdmin` before any command runs |
| **Command orchestrators** | Complex commands share logic via helpers (`executeSilence`, `applyWarn`) instead of duplicating code |
| **Feature flags** | `Chat.features` map — all default to `false` (G8). Toggled per-chat by owner via `/togglefeature` or the dashboard |
| **Structured logging** | JSON logger with `action` tags — no raw `console.log` in production code (G11) |
| **Shared HTTP process** | The same Node process runs the Grammy bot (long polling) and serves the React SPA + REST API |

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Language | TypeScript 5.x / Node.js 20 |
| Bot framework | [Grammy](https://grammy.dev) |
| Database | MongoDB Atlas + Mongoose 9 |
| HTTP API | Express 4 |
| Web client | React 18 + React Router 6 + Vite 5 |
| Auth | Telegram Login Widget + username/password (bcryptjs) + JWT |
| Testing | Vitest |
| Linting | ESLint 9 (flat config) + Prettier |
| CI | GitHub Actions |
| Deployment | Railway (Docker) |

---

## Project Structure

```
src/
├── index.ts                  ← Entry point: bot + middleware + commands + API server
├── config/
│   └── index.ts              ← Environment variable parsing
├── types/
│   └── index.ts              ← Enums, Mongoose interfaces, BotContext
├── locales/
│   └── es.json               ← Spanish user-facing strings
├── db/
│   ├── connection.ts         ← MongoDB connect/disconnect
│   ├── models/               ← Mongoose schemas
│   │   ├── Chat.ts           Admin.ts        User.ts
│   │   ├── Topic.ts          Message.ts      Credential.ts
│   │   ├── ActivityLog.ts    BannedWord.ts   SpamPattern.ts
│   │   └── UserDomainAllowance.ts
│   └── repositories/         ← Data-access layer (one per entity)
├── bot/
│   ├── commands/             ← One file per command handler
│   ├── handlers/             ← chat_member, media forwarding, spam callbacks
│   ├── helpers/              ← Shared reusable logic
│   │   ├── html.ts               ← Escaping, displayName, mention
│   │   ├── contextHelpers.ts     ← parseArgs, buildActor, getChatTitle
│   │   ├── detectMessageType.ts
│   │   ├── resolveTarget.ts      ← User resolution (reply → mention → DB → API)
│   │   ├── applyWarn.ts          ← Warning cycle with auto-ban
│   │   ├── executeSilence.ts     ← Orchestrator for sil/elsil/silav/elsilav
│   │   ├── sendAndAutoDelete.ts
│   │   ├── sendLog.ts            ← Audit log builder + sender (gated by logFlags)
│   │   ├── forwardToLog.ts       ← Forward replied message into the log channel
│   │   ├── profilePhoto.ts       ← Cached avatar resolution
│   │   ├── silenceUser.ts
│   │   ├── unsilenceUser.ts
│   │   ├── kickTracker.ts
│   │   └── lastMessageTracker.ts
│   └── middleware/
│       ├── loadChat.ts       ← Loads Chat doc, enforces whitelist
│       ├── trackUser.ts      ← Upserts User doc per message sender
│       ├── trackTopic.ts     ← Records new/edited forum topics
│       ├── isAdmin.ts        ← Sets ctx.isAdmin (DB + API fallback)
│       └── adminOnlyCommands.ts ← Blocks non-admin command usage
├── features/
│   ├── topicFiltering/
│   ├── promoSpamDetection/   ← Heuristic + learned-pattern spam detection
│   └── bannedWordsEnforcement/
├── api/
│   ├── server.ts             ← Express app factory
│   ├── middleware/           ← authenticate, requireChatAdmin
│   ├── routes/               ← auth, chats, topics, users, whitelist,
│   │                            bannedWords, activityLogs, admins, photos,
│   │                            spamDetections
│   └── services/             ← userActions
├── cli/
│   └── credentials.ts        ← cred:add / cred:list / cred:rm (web auth seeding)
└── utils/
    ├── logger.ts             ← Structured JSON logger
    ├── activityLog.ts
    └── bannedWord.ts

web/                          ← Vite + React SPA (built into web/dist by `build:web`)
├── index.html
├── package.json
├── vite.config.ts
└── src/
    ├── main.tsx              App.tsx
    ├── components/           ← AppBar, ChatAvatar, Dropdown, SlideToConfirm, …
    ├── screens/              ← Chats, Dashboard, Users, UserDetail, Admins,
    │                            Topics, TopicEdit, BannedWords, Whitelist,
    │                            Logs, Login, AccountSettings, Features
    ├── lib/                  ← api client, auth, theme, hooks
    ├── styles/yukibot.css
    └── types/api.ts

tests/                        ← Vitest suites (helpers, middleware, features, …)
```

---

## Getting Started

### Prerequisites

- Node.js 20+
- MongoDB Atlas (free M0 tier works)
- Telegram Bot token from [@BotFather](https://t.me/BotFather)
- For the dashboard: a domain registered with BotFather via `/setdomain` so the Telegram Login Widget renders

### Setup

```bash
# Clone
git clone https://github.com/Yuki44/YukiBot-Telegram-Admin.git
cd YukiBot-Telegram-Admin

# Install both workspaces
npm install
npm run install:web

# Configure
cp .env.example .env
# Fill in BOT_TOKEN, MONGODB_URI, ADMIN_IDS, BOT_USERNAME, JWT_SECRET, …

# Development — bot + API in one process
npm run dev

# Development — Vite dev server for the SPA (separate terminal)
npm run dev:web

# Production build (web bundle + tsc)
npm run build
npm start
```

By default, `npm run dev` starts the bot, the Express API, and serves any pre-built SPA from `web/dist`. Use `npm run dev:web` alongside it for hot-reload of the React frontend.

### Seeding a dashboard login

The dashboard primarily uses the Telegram Login Widget, but you can also create a username/password credential for the same Telegram user:

```bash
npm run cred:add -- <username> <yourTelegramId> "<displayName>"
npm run cred:list
npm run cred:rm  -- <username>
```

The credential binds to a Telegram numeric user ID, so the user sees exactly the chats they are an admin in. If their ID is also in `ADMIN_IDS`, they get super-admin powers (every chat).

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `BOT_TOKEN` | ✅ | Telegram Bot API token from BotFather |
| `BOT_USERNAME` | ✅* | Bot username without `@` — required by the dashboard's Telegram Login Widget |
| `BOT_LOGIN_DOMAIN` | Optional | Domain registered via BotFather `/setdomain` (e.g. `yukibot.dev`). The widget only renders when `window.location.hostname` matches |
| `MONGODB_URI` | ✅ | MongoDB Atlas connection string |
| `JWT_SECRET` | ✅ | 32+ char secret used to sign dashboard JWTs |
| `ADMIN_IDS` | Optional | Comma-separated Telegram user IDs that get super-admin access (all chats) in the dashboard |
| `PORT` | Optional | HTTP port for Express (default `3000`, Railway sets automatically) |
| `BOT_ENABLED` | Optional | Set to `"false"` to run the API only (skip bot polling) — useful for local web work or migrations |
| `TOPIC_RULES` | Optional | Legacy JSON for static topic rules; runtime DB rules take precedence |

\* `BOT_USERNAME` is technically optional but the Telegram Login Widget will not render without it.

---

## Commands Reference

All commands are admin-only. User-facing messages are in Spanish.

### Warnings

| Command | Description |
|---------|-------------|
| `/av` | Warn user (max 3 → auto-ban at 3) |
| `/elav` | Delete replied message + warn |
| `/qav` | Remove last warning |
| `/avs` | Check warning count |

### Silence

| Command | Description |
|---------|-------------|
| `/sil` | Silence for 1 week |
| `/elsil` | Delete replied message + silence |
| `/silav` | Silence + warn |
| `/elsilav` | Delete replied message + silence + warn |
| `/qsil` | Unsilence user |
| `/qsilav` | Unsilence + remove last warning |

### Kicks & bans

| Command | Description |
|---------|-------------|
| `/kk` | Kick (user can rejoin) |
| `/bn` | Ban permanently (auto-rebans on rejoin via `wasBanned`) |
| `/qban` | Pardon — delete user record + unban |

### Anti-spam

| Command | Description |
|---------|-------------|
| `/spam` | Reply to a message → delete + silence + warn + learn the pattern |
| `/nospam` | Remove a learned pattern by pattern ID or user ID |
| `/wladd` / `/wldel` / `/wls` | Manage the per-chat link whitelist |
| `/wluadd` / `/wludel` / `/wlus` | Manage the per-chat spam-detection user whitelist |

### Configuration (owner only)

| Command | Description |
|---------|-------------|
| `/setup` | Initialize chat configuration (creator only — bypasses whitelist) |
| `/addtopic` | Add topic content rules (forum chats only) |
| `/edittopic` | Edit existing topic rules |
| `/removetopic` | Remove topic rules |
| `/togglefeature` | Toggle a feature flag |

### Help

| Command | Description |
|---------|-------------|
| `/com` | Show the full command list (auto-deletes) |

---

## Web Dashboard

The dashboard lives in `web/` (Vite + React + React Router) and is served by the same Express app that exposes the REST API at `/api/*`.

### Screens

- **Chats** — every chat the signed-in user is admin of
- **Dashboard** — per-chat overview + feature toggles
- **Features** — toggle flags, edit log gates, edit forward target
- **Users / User detail** — search, view warnings, ban/silence/pardon from the UI
- **Admins** — list admins, hide from dashboard, delegate owner powers
- **Topics / Topic edit** — configure `allowedMsgTypes`, mark `adminOnly`, edit name
- **Banned words** — chat- or topic-scoped rules with configurable actions
- **Whitelist** — link whitelist + per-user domain allowances ("Mixtos")
- **Logs** — 90-day queryable activity log with type filters and undo for reversible actions
- **Account settings** — username/password credentials, theme

### Auth

1. **Telegram Login Widget** — the primary flow; only renders when `window.location.hostname === BOT_LOGIN_DOMAIN`.
2. **Username + password** — for users with a `Credential` row (seeded via the CLI). Authenticates as a Telegram user ID, so chat visibility is identical to the widget flow.

Successful login returns a JWT; the SPA stores it and attaches it to API calls as `Authorization: Bearer <token>`.

---

## Middleware Pipeline

```
loadChat → trackUser → trackTopic → isAdmin → adminOnlyCommands → command/feature handlers
```

1. **loadChat** — Loads the `Chat` document, enforces `whitelist`. Sets `ctx.chatConfig` (or `null` to ignore).
2. **trackUser** — Upserts a `User` document for every message sender.
3. **trackTopic** — Records new/edited forum topics into the `Topic` collection so the dashboard sees them.
4. **isAdmin** — Sets `ctx.isAdmin` from the `Admin` collection (with Telegram API fallback).
5. **adminOnlyCommands** — Deletes messages from non-admins that use protected commands.

> `/setup` bypasses whitelist and `adminOnlyCommands`.

---

## Feature Flags

Stored in `Chat.features`. All default to `false`.

| Flag | Description |
|------|-------------|
| `topicFiltering` | Per-topic message-type enforcement (deletes content that doesn't match `allowedMsgTypes`) |
| `autoBan` | Auto-reban users with `wasBanned: true` on rejoin |
| `autoWarnSpam` | Auto-warn when spam is detected by Group Help bot (legacy) |
| `promoSpamDetection` | Heuristic link analysis + learned patterns (`/spam` to teach) |
| `bannedWordsEnforcement` | Enforce `BannedWord` rules (delete/warn/silence/kick) |
| `languageDetection` | Reserved for future AI-powered language detection |

---

## Database Schema

| Entity | Key Fields | Unique Index |
|--------|------------|--------------|
| **Chat** | chatId, name, type, isActive, whitelist, features, linkWhitelist, spamUserWhitelist, hiddenAdminIds, delegatedOwnerId, logsTo, forwardsTo, logFlags | `chatId` |
| **Admin** | userId, username, name, chatId, chatName, role | `userId + chatId` |
| **User** | userId, chatId, warnings, warningReasons, isMuted, muteUntil, isBanned, wasBanned, photoFileId | `userId + chatId` |
| **Topic** | chatId, topicId, name, allowedMsgTypes, adminOnly, isUserConfigured | `chatId + topicId` |
| **Message** | userId, chatId, fingerprint, timestamp | TTL 48 h auto-delete |
| **SpamPattern** | chatId, pattern, fingerprint, learnedBy, createdAt | per-chat patterns |
| **BannedWord** | chatId, word, severity, actions, kick, flag, exactMatch, scope, topicId | per chat or topic |
| **UserDomainAllowance** | chatId, userId, domains | per chat/user |
| **ActivityLog** | chatId, type, source, actorId, targetId, timestamp | TTL 90 days |
| **Credential** | username, passwordHash, userId, name | unique username |

---

## Testing

```bash
npm test               # one-shot
npm run test:watch     # watch mode
npm run test:coverage  # coverage report
```

Tests cover:

- **Pure helpers** — HTML escaping, message-type detection, link analyzer, banned-word matcher
- **Helpers** — context extraction, kick tracker, logger
- **Middleware** — admin-only command filtering, whitelist enforcement
- **Features** — promo-spam detection, banned-word enforcement, topic filtering

---

## Deployment

### Railway (Production)

Deployed via GitHub auto-deploy. The `Dockerfile` builds both workspaces (web + bot) before pruning dev dependencies:

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run install:web && npm run build
RUN npm prune --production
CMD ["npm", "start"]
```

Environment variables are configured in the Railway dashboard.

### Docker (Local)

```bash
docker build -t yukibot .
docker run --env-file .env -p 3000:3000 yukibot
```

### Single-instance constraint ⚠️

The Telegram Bot API allows **only one polling instance per bot token**. To develop locally you must stop the Railway deployment first (or set `BOT_ENABLED=false` locally).

---

## Design Decisions

1. **Repository pattern** — Decouples business logic from Mongoose, making commands and API routes testable and the data layer swappable.
2. **Command orchestrators** — `executeSilence` consolidates 4 commands (sil, elsil, silav, elsilav) into one parameterised flow, eliminating ~300 lines of duplication.
3. **Shared HTML helpers** — `esc()`, `displayName()`, `mention()` defined once, imported everywhere.
4. **Structured JSON logging** — Every log entry is machine-parseable with `action`, `userId`, `chatId` fields — ready for log aggregation.
5. **Named constants** — `MAX_WARNINGS`, `SILENCE_DURATION_S`, etc. replace magic numbers across the codebase.
6. **Graceful shutdown** — `SIGTERM`/`SIGINT` stop the bot, close the HTTP server, and disconnect MongoDB cleanly.
7. **Global error handler** — `bot.catch()` prevents unhandled Grammy errors from crashing the process.
8. **One process, two surfaces** — Running the bot and API in the same Node process keeps deployment trivial on a single Railway service.
9. **Activity log is additive** — The bot still streams real-time logs to `logsTo` on Telegram; the `ActivityLog` collection only exists to power the dashboard's queryable history.
10. **Topic auto-discovery + `isUserConfigured`** — Newly discovered forum topics are treated as "allow everything" until an owner explicitly saves them in the dashboard, so the bot never silently nukes a new topic.

---

## Guardrails

| # | Rule |
|---|------|
| G1 | Never commit `BOT_TOKEN`, `MONGODB_URI`, or `JWT_SECRET` |
| G2 | Never hardcode chatIds, userIds, or credentials in source code |
| G3 | Never set `wasBanned` back to `false` |
| G4 | Never remove the admin-bypass check — the bot must not touch admin messages |
| G5 | Bot only sends messages to groups for: warn, auto-reban, silence (auto-deletes) |
| G6 | `/setup` always bypasses whitelist + adminOnlyCommands |
| G7 | New commands must be added to the `adminOnlyCommands` set |
| G8 | New features must have a flag defaulting to `false` |
| G9 | All DB calls wrapped in `try/catch` — the bot never crashes from MongoDB |
| G10 | Errors logged with tags, never sent to group chat |
| G11 | No `console.log` — use the structured `logger` |
| G12 | Comments explain **why**, not what — omit obvious comments |
| G13 | Every change must pass `tsc --noEmit`, `npm run format:check`, `npm run lint`, and `npm test` |

---

## License

ISC
