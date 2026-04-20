# YukiBot — Telegram Group Moderation Bot

> A TypeScript-based Telegram bot for automated group moderation with topic-scoped content filtering, multi-tier warning system, and comprehensive audit logging.

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
- [Middleware Pipeline](#middleware-pipeline)
- [Feature Flags](#feature-flags)
- [Database Schema](#database-schema)
- [Testing](#testing)
- [Deployment](#deployment)
- [Design Decisions](#design-decisions)
- [Guardrails](#guardrails)

---

## Features

- **Multi-tier warning system** — 1/3 → 2/3 → 3/3 automatic ban with reasons and audit trail
- **Topic-scoped content filtering** — per-topic rules for message types (photo, video, text, etc.) in forum-style chats
- **Silence / Unsilence** — restrict users for 1 week with Telegram API verification
- **Kick / Ban / Pardon** — full moderation lifecycle with permanent `wasBanned` flag
- **Auto-reban** — users with `wasBanned: true` are automatically re-banned on rejoin
- **Auto-warn spam** — integrates with Group Help bot's spam log to auto-apply warnings
- **Comprehensive audit logging** — all moderation actions logged to a dedicated channel with deep links
- **Media forwarding** — automatically forward photos/videos to a collection channel
- **Ephemeral messages** — bot confirmations auto-delete to keep the chat clean
- **Feature flags** — all features default to `false` and are toggled per-chat by the owner

---

## Architecture

```
┌──────────────────────────────────────────────────────────┐
│                    Telegram Bot API                       │
└──────────────────────┬───────────────────────────────────┘
                       │
                       ▼
┌──────────────────────────────────────────────────────────┐
│                  Grammy Framework                         │
│  ┌─────────────────────────────────────────────────────┐ │
│  │           Middleware Pipeline (ordered)              │ │
│  │  loadChat → trackUser → isAdmin → adminOnlyCommands │ │
│  └─────────────────────────────────────────────────────┘ │
│  ┌──────────────┐ ┌──────────────┐ ┌─────────────────┐  │
│  │   Commands    │ │   Handlers   │ │    Features     │  │
│  │  (bot/cmds/)  │ │ (bot/hdlrs/) │ │  (features/)   │  │
│  └──────┬───────┘ └──────┬───────┘ └───────┬─────────┘  │
│         └────────────────┼─────────────────┘             │
│                          ▼                               │
│  ┌─────────────────────────────────────────────────────┐ │
│  │              Shared Helpers Layer                    │ │
│  │  resolveTarget · applyWarn · executeSilence          │ │
│  │  sendAndAutoDelete · sendLog · html · contextHelpers │ │
│  └──────────────────────┬──────────────────────────────┘ │
└─────────────────────────┼────────────────────────────────┘
                          ▼
┌──────────────────────────────────────────────────────────┐
│                Repository Pattern (DAL)                   │
│  chatRepo · adminRepo · userRepo · topicRepo · msgRepo   │
└──────────────────────┬───────────────────────────────────┘
                       ▼
┌──────────────────────────────────────────────────────────┐
│           MongoDB Atlas (Mongoose ODM)                    │
│  Chat · Admin · User · Topic · Message                   │
└──────────────────────────────────────────────────────────┘
```

### Key Patterns

| Pattern | Description |
|---------|-------------|
| **Repository** | All database access through `src/db/repositories/` — no direct model calls from commands or middleware |
| **Middleware chain** | Ordered pipeline enriches `BotContext` with `chatConfig` and `isAdmin` before any command runs |
| **Command orchestrators** | Complex commands share logic via helpers (`executeSilence`, `applyWarn`) instead of duplicating code |
| **Feature flags** | `Chat.features` map — all default to `false` (G8). Toggled per-chat by owner |
| **Structured logging** | JSON logger with `action` tags — no raw `console.log` in production code (G11) |

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Language | TypeScript 5.x / Node.js 20 |
| Bot Framework | [Grammy](https://grammy.dev) |
| Database | MongoDB Atlas + Mongoose 9 |
| Testing | Vitest |
| Linting | ESLint 9 (flat config) + Prettier |
| CI | GitHub Actions |
| Deployment | Railway (Docker) |

---

## Project Structure

```
src/
├── index.ts                  ← Entry point, middleware + command registration
├── config/
│   ├── index.ts              ← Environment variable parsing
│   └── constants.ts          ← Named constants (MAX_WARNINGS, durations, etc.)
├── types/
│   └── index.ts              ← Enums, Mongoose interfaces, BotContext
├── db/
│   ├── connection.ts         ← MongoDB connect/disconnect
│   ├── models/               ← Mongoose schemas (Chat, Admin, User, Topic, Message)
│   └── repositories/         ← Data access layer (one per entity)
├── bot/
│   ├── commands/             ← One file per command handler
│   ├── handlers/             ← Event handlers (chat_member, media, spam)
│   ├── helpers/              ← Shared reusable logic
│   │   ├── html.ts           ← HTML escaping (esc, displayName, mention)
│   │   ├── contextHelpers.ts ← parseArgs, buildActor, getChatTitle
│   │   ├── detectMessageType.ts
│   │   ├── resolveTarget.ts  ← User resolution (reply → mention → DB → API)
│   │   ├── applyWarn.ts      ← Warning cycle with auto-ban
│   │   ├── executeSilence.ts ← Orchestrator for sil/elsil/silav/elsilav
│   │   ├── sendAndAutoDelete.ts
│   │   ├── sendLog.ts        ← Audit log builder + sender
│   │   ├── silenceUser.ts
│   │   ├── unsilenceUser.ts
│   │   ├── kickTracker.ts
│   │   └── lastMessageTracker.ts
│   └── middleware/
│       ├── loadChat.ts       ← Loads Chat doc, enforces whitelist
│       ├── trackUser.ts      ← Upserts User doc per message sender
│       ├── isAdmin.ts        ← Sets ctx.isAdmin (DB + API fallback)
│       └── adminOnlyCommands.ts ← Blocks non-admin command usage
├── features/
│   └── topicFiltering/       ← Feature-flag-gated topic content rules
└── utils/
    └── logger.ts             ← Structured JSON logger
tests/
├── config/                   ← Constants tests
├── helpers/                  ← Pure function + helper tests
└── middleware/               ← Middleware unit tests
```

---

## Getting Started

### Prerequisites

- Node.js 20+
- MongoDB Atlas (free M0 tier works)
- Telegram Bot Token from [@BotFather](https://t.me/BotFather)

### Setup

```bash
# Clone
git clone https://github.com/Yuki44/YukiBot-Telegram-Admin.git
cd YukiBot-Telegram-Admin

# Install
npm install

# Configure
cp .env.example .env
# Edit .env with your BOT_TOKEN, MONGODB_URI, ADMIN_IDS

# Development
npm run dev

# Production build
npm run build
npm start
```

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `BOT_TOKEN` | ✅ | Telegram Bot API token from BotFather |
| `MONGODB_URI` | ✅ | MongoDB Atlas connection string |
| `ADMIN_IDS` | Optional | Comma-separated Telegram user IDs for global admins |
| `BOT_ENABLED` | Optional | Set to `"false"` to disable (dry-run mode) |

---

## Commands Reference

All commands are admin-only. User-facing messages are in Spanish.

| Command | Description |
|---------|-------------|
| `/setup` | Initialize chat configuration (creator only) |
| `/addtopic` | Add topic content rules (forum chats only) |
| `/edittopic` | Edit existing topic rules |
| `/removetopic` | Remove topic rules |
| `/togglefeature` | Toggle a feature flag (owner only) |
| `/av` | Warn user (max 3, auto-ban at 3) |
| `/elav` | Delete message + warn |
| `/qav` | Remove last warning |
| `/avs` | Check warning count |
| `/sil` | Silence for 1 week |
| `/elsil` | Delete message + silence |
| `/silav` | Silence + warn |
| `/elsilav` | Delete message + silence + warn |
| `/qsil` | Unsilence user |
| `/qsilav` | Unsilence + remove last warning |
| `/kk` | Kick (user can rejoin) |
| `/bn` | Ban permanently |
| `/qban` | Pardon — delete record + unban |
| `/com` | Show command list |

---

## Middleware Pipeline

```
loadChat → trackUser → isAdmin → adminOnlyCommands → command/feature handlers
```

1. **loadChat** — Loads `Chat` document from DB, enforces whitelist. Sets `ctx.chatConfig`.
2. **trackUser** — Upserts `User` document for every message sender (deduped per bot run).
3. **isAdmin** — Sets `ctx.isAdmin` by checking Admin collection + Telegram API fallback.
4. **adminOnlyCommands** — Deletes messages from non-admins that use protected commands.

> `/setup` bypasses whitelist and adminOnlyCommands middleware.

---

## Feature Flags

Stored in `Chat.features`. All default to `false`.

| Flag | Description |
|------|-------------|
| `topicFiltering` | Per-topic message type enforcement |
| `autoBan` | Auto-reban users with `wasBanned: true` on rejoin |
| `autoWarnSpam` | Auto-warn when spam is detected by Group Help bot |
| `commands` | Reserved for future use |
| `languageDetection` | Reserved for future AI-powered language detection |
| `spamDetection` | Reserved for future AI-powered spam detection |

---

## Database Schema

| Entity | Key Fields | Unique Index |
|--------|------------|--------------|
| **Chat** | chatId, name, type, isActive, whitelist, features, logsTo | `chatId` |
| **Admin** | userId, username, name, chatId, role | `userId + chatId` |
| **User** | userId, chatId, warnings, isBanned, wasBanned | `userId + chatId` |
| **Topic** | chatId, topicId, name, allowedMsgTypes | `chatId + topicId` |
| **Message** | userId, chatId, fingerprint, timestamp | TTL 48h auto-delete |

---

## Testing

```bash
# Run all tests
npm test

# Watch mode
npm run test:watch

# Coverage report
npm run test:coverage
```

Tests cover:
- **Pure functions** — HTML escaping, message type detection, spam log parsing
- **Helpers** — Context extraction, kick tracker, logger
- **Middleware** — Admin-only command filtering

---

## Deployment

### Railway (Production)

Deployed via GitHub auto-deploy. The `Dockerfile` handles the build:

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build
RUN npm prune --production
CMD ["npm", "start"]
```

### Docker (Local)

```bash
docker build -t yukibot .
docker run --env-file .env yukibot
```

---

## Design Decisions

1. **Repository pattern** — Decouples business logic from Mongoose, making commands testable and the data layer swappable.
2. **Command orchestrators** — `executeSilence` consolidates 4 commands (sil, elsil, silav, elsilav) into one parameterised flow, eliminating ~300 lines of duplication.
3. **Shared HTML helpers** — `esc()`, `displayName()`, `mention()` defined once, imported everywhere.
4. **Structured JSON logging** — Every log entry is machine-parseable with `action`, `userId`, `chatId` fields — ready for log aggregation.
5. **Named constants** — `MAX_WARNINGS`, `SILENCE_DURATION_S`, etc. replace magic numbers across the codebase.
6. **Graceful shutdown** — `SIGTERM`/`SIGINT` handlers stop the bot and disconnect MongoDB cleanly.
7. **Global error handler** — `bot.catch()` prevents unhandled Grammy errors from crashing the process.

---

## Guardrails

| # | Rule |
|---|------|
| G1 | Never commit `BOT_TOKEN` or `MONGODB_URI` |
| G2 | Never hardcode chatIds, userIds, or credentials |
| G3 | Never set `wasBanned` back to `false` |
| G4 | Never remove the admin-bypass check |
| G5 | Bot only sends messages to groups for: warn, auto-reban, silence (auto-deletes) |
| G6 | `/setup` always bypasses whitelist + adminOnlyCommands |
| G7 | New commands must be added to the adminOnlyCommands set |
| G8 | New features must have a flag defaulting to `false` |
| G9 | All DB calls wrapped in try/catch |
| G10 | Errors logged with tags, never sent to group chat |
| G11 | No `console.log` — use structured `logger` |

---

## License

ISC
