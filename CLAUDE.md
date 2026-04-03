# CLAUDE.md — AI Context

## Project

Telegram group moderation bot built with Grammy (TypeScript).
See [AGENTS.md](AGENTS.md) for full architecture, entities, and commands.

## Rules

- Never delete messages from admins (G4)
- All topic rules live in config.ts
- No hardcoded IDs outside of .env or config (G2)
- wasBanned must NEVER revert to false (G3)
- All DB calls wrapped in try/catch (G9)
- All new features default to false (G8)
- Errors logged with tags, never sent to group chat (G10)

## Key Files

- `src/index.ts` — entry point, middleware + command registration
- `src/bot/helpers/` — resolveTarget, applyWarn, sendAndAutoDelete
- `src/db/repositories/` — all DB access (repository pattern)
- `src/config/index.ts` — env parsing

## Topic Files

| File | Scope |
| ---- | ----- |
| [AGENTS.md](AGENTS.md) | Full project context + topic index |
| [.github/instructions/coding-conventions.md](.github/instructions/coding-conventions.md) | TS style, Grammy patterns, error handling |
| [.github/instructions/yukibot-workflow.md](.github/instructions/yukibot-workflow.md) | Middleware, features, command patterns |
| [docs/agents/developer-workflows.md](docs/agents/developer-workflows.md) | npm, Railway, local dev, MongoDB |
| [docs/agents/pull-requests.md](docs/agents/pull-requests.md) | Branches, PRs, merge rules |
