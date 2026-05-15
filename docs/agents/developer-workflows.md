# Developer Workflows — YukiBot

> npm scripts, deployment, local config, MongoDB setup, dashboard seeding, and initial chat onboarding.

## npm Scripts

| Script                | Command                                  | Purpose                                            |
| --------------------- | ---------------------------------------- | -------------------------------------------------- |
| `npm run dev`         | `nodemon src/index.ts`                   | Local dev — bot + API in one process               |
| `npm run dev:web`     | `npm --prefix web run dev`               | Vite dev server for the React SPA (hot reload)     |
| `npm run build`       | `npm run build:web && npm run build:bot` | Build the SPA bundle then compile TS               |
| `npm run build:bot`   | `tsc`                                    | Compile TypeScript to `dist/`                      |
| `npm run build:web`   | `npm --prefix web run build`             | Build the React SPA into `web/dist`                |
| `npm run install:web` | `npm --prefix web ci`                    | Install the SPA's own dependencies                 |
| `npm start`           | `node dist/index.js`                     | Run the production build                           |
| `npm run lint`        | `eslint src/`                            | ESLint over the bot/API sources                    |
| `npm run lint:fix`    | `eslint src/ --fix`                      | Auto-fix lint issues                               |
| `npm run format`      | `prettier --write "src/**/*.ts"`         | Auto-format TS sources                             |
| `npm run format:check`| `prettier --check "src/**/*.ts"`         | CI-style format check                              |
| `npm test`            | `vitest run`                             | One-shot test run                                  |
| `npm run test:watch`  | `vitest`                                 | Watch mode                                         |
| `npm run test:coverage` | `vitest run --coverage`                | Coverage report                                    |
| `npm run cred:add`    | `ts-node src/cli/credentials.ts add`     | Seed a dashboard username/password (see below)     |
| `npm run cred:list`   | `ts-node src/cli/credentials.ts list`    | List dashboard credentials                         |
| `npm run cred:rm`     | `ts-node src/cli/credentials.ts rm`      | Remove a dashboard credential                      |

## Single Instance Constraint ⚠️

Grammy (Telegram Bot API) allows **only one polling instance per bot token** at a time.
If the bot is running in production (Railway), you **must stop it** before running locally — or set `BOT_ENABLED=false` locally so only the API/dashboard runs.

- To develop locally with the bot: disable the Railway deployment first, then `npm run dev`.
- To develop locally web-only: set `BOT_ENABLED=false` in `.env`, then `npm run dev` + `npm run dev:web`.
- To go back to production: stop local dev, re-enable Railway deployment.

Running two polling instances simultaneously causes update conflicts and dropped messages.

## Local Development

1. Clone repo.
2. `npm install` (root) and `npm run install:web` (web workspace).
3. Copy `.env.example` to `.env` and fill it in:
   ```
   BOT_TOKEN=<from BotFather>
   BOT_USERNAME=<bot username without @>
   BOT_LOGIN_DOMAIN=<optional; domain registered via BotFather /setdomain>
   MONGODB_URI=<Atlas connection string>
   JWT_SECRET=<32+ char random hex>
   ADMIN_IDS=<comma-separated user IDs>
   PORT=3000
   BOT_ENABLED=true
   ```
4. Ensure the production instance is stopped (or `BOT_ENABLED=false`).
5. `npm run dev` — bot + Express API start with nodemon + ts-node.
6. (Optional) `npm run dev:web` in a second terminal — Vite dev server with hot reload for the SPA.

> ⚠️ `.env` is gitignored. Never commit tokens or the JWT secret.

### Generating a JWT secret

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## Seeding Dashboard Logins

The dashboard's primary auth is the Telegram Login Widget, but you can also create username/password credentials for any Telegram user (e.g. for hosts without a registered widget domain or for testing):

```bash
npm run cred:add  -- <username> <telegramId> "<displayName>"
npm run cred:list
npm run cred:rm   -- <username>
```

- The credential binds to a Telegram numeric user ID, so the user sees exactly the chats they are admin in (via the `Admin` collection).
- Passwords are prompted twice (no echo), minimum 8 chars.
- If the Telegram ID is also in `ADMIN_IDS`, the user gets super-admin powers (all chats).

## Railway Deployment

- Auto-deploys from `main` branch via GitHub integration.
- Config: `railway.json` + `Dockerfile`.
- Environment variables set in the Railway dashboard (not in repo).
- Build: `npm run install:web && npm run build` → Start: `npm start`.
- The same container serves the API + SPA + bot polling.

## MongoDB Atlas (M0 Free)

- Connection via `src/db/connection.ts` using `MONGODB_URI`.
- Use **MongoDB Compass** for manual data inspection and edits.
- All collections use compound unique indexes (see [AGENTS.md](../../AGENTS.md)).

## Initial Chat Setup Flow

When adding YukiBot to a new Telegram group:

1. Add the bot to the group; grant **Delete Messages** + **Ban Users** permissions.
2. Group owner sends `/setup` — creates a Chat doc with `whitelist: false`.
3. In MongoDB Compass (or the dashboard, if you have super-admin access), set `whitelist: true` on the new Chat document.
4. For topics-type groups: configure topics from the dashboard ("Topics" screen) or via `/addtopic` so `isUserConfigured` flips to `true` and `allowedMsgTypes` becomes authoritative.
5. Use `/togglefeature` (or the dashboard's Features screen) to enable desired features (all default `false`).

### Why manual whitelist?

Whitelist is intentionally manual to prevent accidental activation in unwanted groups.
The bot only processes messages in whitelisted chats.

## Bot Permissions Per Chat

| Permission       | Required | Used for                        |
| ---------------- | -------- | ------------------------------- |
| Delete Messages  | ✅       | Removing rule-breaking content  |
| Ban Users        | ✅       | Ban + restrict/mute             |
| Post Messages    | ✅       | Log channel posts + warnings    |

## Log Channel Setup

- Set `logsTo` on the Chat doc to a channel chatId (or use the dashboard's Features screen).
- The bot must be admin in the log channel with **Post Messages** permission.
- Individual log categories are gated by `Chat.logFlags` (e.g. `logWarns`, `logBans`, `logSilences`, …) — toggle them per-chat.
- `forwardsTo` works the same way for media collection channels.

## Debugging

- Railway / production: logs are emitted as structured JSON by `src/utils/logger.ts`. Filter by the `action` field (e.g. `action=silence`, `action=auto_reban`, `action=spam.detect`).
- Local: all output goes to stdout/stderr in the same JSON shape.
- Set `BOT_ENABLED=false` to keep the API up while disabling bot polling (useful for migrations and dashboard-only work).
