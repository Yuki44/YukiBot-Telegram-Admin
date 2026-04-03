# Developer Workflows — YukiBot

> npm scripts, deployment, local config, MongoDB setup, and initial chat onboarding.

## npm Scripts

| Script          | Command              | Purpose                              |
| --------------- | -------------------- | ------------------------------------ |
| `npm run dev`   | `nodemon src/index.ts` | Local dev with hot-reload           |
| `npm run build` | `tsc`                | Compile TypeScript to `dist/`       |
| `npm start`     | `node dist/index.js` | Run production build                |

## Single Instance Constraint ⚠️

Grammy (Telegram Bot API) allows **only one polling instance per bot token** at a time.
If the bot is running in production (Railway), you **must stop it** before running locally, and vice versa.

- To develop locally: disable the Railway deployment first, then `npm run dev`.
- To go back to production: stop local dev, re-enable Railway deployment.

Running two instances simultaneously causes update conflicts and dropped messages.

## Local Development

1. Clone repo.
2. `npm install`
3. Create `.env` in project root:
   ```
   BOT_TOKEN=<from BotFather>
   MONGODB_URI=<Atlas connection string>
   BOT_ENABLED=true
   ADMIN_IDS=<comma-separated user IDs>
   ```
4. Ensure production instance is stopped.
5. `npm run dev` — bot starts with nodemon + ts-node.

> ⚠️ `.env` is gitignored. Never commit tokens.

## Railway Deployment

- Auto-deploys from `main` branch via GitHub integration.
- Config: `railway.json` + `Dockerfile`.
- Environment variables set in Railway dashboard (not in repo).
- Build: `npm run build` → Start: `npm start`.

## MongoDB Atlas (M0 Free)

- Connection via `src/db/connection.ts` using `MONGODB_URI`.
- Use **MongoDB Compass** for manual data inspection and edits.
- All collections use compound unique indexes (see AGENTS.md).

## Initial Chat Setup Flow

When adding YukiBot to a new Telegram group:

1. Add bot to group, grant **Delete Messages** + **Ban Users** permissions.
2. Group owner sends `/setup` — creates Chat doc with `whitelist: false`.
3. In MongoDB Compass, set `whitelist: true` on the new Chat document.
4. For topics-type groups: use `/addtopic` to define allowed content per topic.
5. Use `/togglefeature` to enable desired features (all default `false`).

### Why manual whitelist?

Whitelist is intentionally manual (Compass) to prevent accidental activation
in unwanted groups. The bot only processes messages in whitelisted chats.

## Bot Permissions Per Chat

| Permission       | Required | Used for                        |
| ---------------- | -------- | ------------------------------- |
| Delete Messages  | ✅       | Removing rule-breaking content  |
| Ban Users        | ✅       | Ban + restrict/mute             |
| Post Messages    | ✅       | Log channels, warnings          |

## Log Channel Setup

- Set `logsTo` field in Chat doc to a channel chatId.
- Bot must be admin in the log channel with Post Messages permission.
- Forward-target chats use `forwardsTo` field similarly.

## Debugging

- Railway logs: filter by log tags (`[ERROR]`, `[DB]`, etc.).
- Local: all output goes to stdout/stderr.
- Set `BOT_ENABLED=false` to prevent the bot from processing messages.
