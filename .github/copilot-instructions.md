# Copilot Instructions — YukiBot

> Always-on guardrails loaded automatically by GitHub Copilot chat.

## Project Summary

YukiBot is a Telegram group moderation bot (TypeScript, Grammy, MongoDB/Mongoose, Railway).

All code, variable names, and logs are in **English**. User-facing bot messages in group chats are in **Spanish**.

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

## Agent Safety

- **NEVER** commit, push, or merge without explicit developer approval.
- Always ask before performing any Git write operation. No exceptions.
- Before running any terminal command, explain briefly what it does and why.
- Ask before running destructive commands (`rm`, `git reset --hard`, `drop`, etc.).

## Key Patterns

- Middleware order: `loadChat → trackUser → isAdmin → adminOnlyCommands → features`
- Repository pattern for all DB access (`src/db/repositories/`)
- `resolveTarget()` for user resolution (reply → text_mention → numeric ID)
- `applyWarn()` for all warning logic (handles 1/3, 2/3, 3/3 auto-ban)
- `sendAndAutoDelete()` for ephemeral bot messages in group chats
- Feature flags in `Chat.features` — toggle with `/togglefeature`

## Further Reading

See [AGENTS.md](../AGENTS.md) for full project context and topic file index.
