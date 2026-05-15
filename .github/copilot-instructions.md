# Copilot Instructions — YukiBot

> Always-on guardrails loaded automatically by GitHub Copilot chat.

## Project Summary

YukiBot is a Telegram group moderation bot **and** companion web dashboard (TypeScript, Grammy, Express, React/Vite, MongoDB/Mongoose, Railway). The bot and the API server run in the same Node process; the SPA lives in `web/` and is built into `web/dist`.

All code, variable names, and logs are in **English**. User-facing bot strings in group chats live in **Spanish** in `src/locales/es.json`.

## Guardrails 🛑

| #  | Rule                                                                 |
| -- | -------------------------------------------------------------------- |
| G1 | NEVER commit `BOT_TOKEN`, `MONGODB_URI`, or `JWT_SECRET`             |
| G2 | NEVER hardcode chatIds, userIds, or credentials in source code       |
| G3 | NEVER set `wasBanned` back to `false`                                |
| G4 | NEVER remove the admin-bypass check — bot must not touch admin msgs  |
| G5 | NEVER send messages to group chats except: warn, auto-reban, silence (auto-deletes after 1 s) |
| G6 | `/setup` MUST always bypass whitelist + adminOnlyCommands middleware  |
| G7 | All new commands MUST be added to the adminOnlyCommands protected list |
| G8 | All new features MUST have a feature flag defaulting to `false`      |
| G9 | All DB calls wrapped in try/catch — bot never crashes from MongoDB   |
| G10| Errors logged with tags, never sent to group chat (silent failures)  |
| G11| No `console.log` left in committed code — use the structured `logger` from `src/utils/logger.ts` |
| G12| Comments must explain **why**, not restate what the code says — omit obvious comments entirely |
| G13| Every change must pass `tsc --noEmit`, `npm run format:check`, and `npm run lint` before being considered done |

## Agent Safety

- **NEVER** commit, push, or merge without explicit developer approval.
- Always ask before performing any Git write operation. No exceptions.
- Before running any terminal command, explain briefly what it does and why.
- Ask before running destructive commands (`rm`, `git reset --hard`, `drop`, etc.).

## Key Patterns

- Middleware order: `loadChat → trackUser → trackTopic → isAdmin → adminOnlyCommands → features`
- Repository pattern for all DB access (`src/db/repositories/`) — used by both bot commands and `src/api/routes/*`
- `resolveTarget()` for user resolution (reply → text_mention → @username → numeric ID)
- `applyWarn()` for all warning logic (handles 1/3, 2/3, 3/3 auto-ban)
- `executeSilence()` for sil/elsil/silav/elsilav — never duplicate the silence flow
- `sendAndAutoDelete()` for ephemeral bot messages in group chats
- `sendLog()` for audit-log channel posts (gated by `Chat.logFlags`)
- Feature flags in `Chat.features` — toggle with `/togglefeature` or the dashboard's Features screen
- User-facing Spanish strings live in `src/locales/es.json` — do not inline them
- Bot polling can be skipped locally with `BOT_ENABLED=false` while keeping the API + dashboard up

## Further Reading

See [AGENTS.md](../AGENTS.md) for full project context and topic file index.
