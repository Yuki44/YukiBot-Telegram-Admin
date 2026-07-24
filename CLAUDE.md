# CLAUDE.md — AI Context

## Project

Telegram group moderation bot + web dashboard built with Grammy + Express + React (TypeScript).
The bot and the API server run in the same Node process.
See [AGENTS.md](AGENTS.md) for full architecture, entities, and commands.

## Rules

- Never delete messages from admins (G4)
- No hardcoded IDs outside of `.env` or config (G2)
- `wasBanned` must NEVER revert to `false` (G3)
- Ban / auto-ban / silence notices are printed then **immediately deleted** — never left visible in the group (G5)
- Never re-implement what the bot already does — reuse `sendLog`, `recordActivity`, `applyWarn`, `handleUserJoin`, … (G14)
- All DB calls wrapped in try/catch (G9)
- All new features default to `false` (G8)
- New commands must be added to the `adminOnlyCommands` set (G7)
- Errors logged with tags via the structured `logger`, never sent to group chat (G10, G11)
- User-facing Spanish strings live in `src/locales/es.json` — do not inline them

## Key Files

- `src/index.ts` — entry point: bot middleware/commands + API server boot
- `src/bot/helpers/` — `resolveTarget`, `applyWarn`, `executeSilence`, `sendLog`, `forwardToLog`, `sendAndAutoDelete`
- `src/db/repositories/` — all DB access (repository pattern, one per entity)
- `src/api/server.ts` — Express app factory; routes under `src/api/routes/`
- `src/config/index.ts` — env parsing (`BOT_TOKEN`, `BOT_USERNAME`, `BOT_LOGIN_DOMAIN`, `JWT_SECRET`, `PORT`, `ADMIN_IDS`, `BOT_ENABLED`)
- `src/cli/credentials.ts` — `cred:add` / `cred:list` / `cred:rm` for dashboard logins
- `web/src/` — React/Vite SPA served from `web/dist`

## Skills

Reusable agent procedures live under `.agents/skills/` — one canonical copy shared across every agent (no per-agent duplication). See [AGENTS.md#skills](AGENTS.md#skills-agentsskills) for the full index; read a skill's `SKILL.md` when its trigger matches the task (e.g. `tdd` before writing code test-first, `code-review` before a commit).

## Agent skills

### Issue tracker

No issue tracker configured — intentionally skipped. Skills needing one (e.g. `code-review`'s Spec axis) fall back to commit-message issue refs or a spec file under `docs/`/`specs/`/`.scratch/`. Re-run `/setup-matt-pocock-skills` to configure one later.

### Domain docs

No `CONTEXT.md`/ADRs — intentionally skipped. Domain vocabulary (entities, feature flags, commands) already lives in [AGENTS.md](AGENTS.md); no separate glossary is maintained.

## Topic Files

| File | Scope |
| ---- | ----- |
| [AGENTS.md](AGENTS.md) | Full project context + topic index |
| [.github/instructions/coding-conventions.md](.github/instructions/coding-conventions.md) | TS style, Grammy patterns, error handling, logger |
| [.github/instructions/yukibot-workflow.md](.github/instructions/yukibot-workflow.md) | Middleware, features, command patterns |
| [docs/agents/developer-workflows.md](docs/agents/developer-workflows.md) | npm scripts, Railway, local dev, MongoDB, dashboard CLI |
| [docs/agents/pull-requests.md](docs/agents/pull-requests.md) | Branches, PRs, merge rules |
| [docs/architecture.md](docs/architecture.md) | Mermaid diagrams + data model |
