# Coding Conventions — YukiBot

> TS style, components, shared objects, log tags, and commenting rules.
> Auto-loaded by GitHub Copilot when editing `src/**` files.

## Language Policy

- All code, variable names, and logs in **English**.
- User-facing bot messages in group chats in **Spanish**.

## TypeScript

- Strict mode enabled (`tsconfig.json`).
- Use `interface` for Mongoose doc shapes, `type` for unions/aliases.
- Prefer `const` over `let`; never use `var`.
- Explicit return types on exported functions.
- No `any` — use `unknown` and narrow.

## Components

| Directory              | Purpose                                          |
| ---------------------- | ------------------------------------------------ |
| `src/bot/commands/`    | One file per command handler, exports `<name>Handler` |
| `src/bot/middleware/`  | Request pipeline stages (loadChat, trackUser, isAdmin, adminOnlyCommands) |
| `src/bot/handlers/`    | Event handlers (chat_member updates, media forwarding) |
| `src/bot/helpers/`     | Shared reusable logic (see below)                |
| `src/db/repositories/` | Data-access layer — one per entity               |
| `src/db/models/`       | Mongoose schemas                                 |
| `src/features/`        | Feature-flag-gated logic (topicFiltering, …)     |
| `src/config/`          | Environment variable parsing                     |
| `src/types/`           | Enums, Mongoose doc interfaces, BotContext       |

## Shared Helpers (`src/bot/helpers/`)

| File                  | Purpose                                                |
| --------------------- | ------------------------------------------------------ |
| `resolveTarget.ts`    | Resolve target user from reply, mention, or numeric ID |
| `applyWarn.ts`        | Warning cycle (1/3 → 2/3 → 3/3 auto-ban)              |
| `sendAndAutoDelete.ts`| Send ephemeral message, auto-delete after delay        |
| `silenceUser.ts`      | Restrict user for 1 week via Telegram API              |
| `unsilenceUser.ts`    | Lift restriction via Telegram API                      |

## Grammy Patterns

- Bot context type: `BotContext` (extends Grammy `Context` with `chatConfig`, `isAdmin`).
- Command handler: `async (ctx: BotContext) => Promise<void>`.
- Middleware: `Middleware<BotContext>` or `(ctx: BotContext, next: NextFunction) => Promise<void>`.
- Always pass `message_thread_id: ctx.message?.message_thread_id` to keep replies in the correct topic.
- Parse mode: always `"HTML"`.

## Repository Pattern

- All DB access through `src/db/repositories/`.
- Never call Mongoose models directly from commands or middleware.

## Error Handling (G9, G10)

- Every DB call wrapped in `try/catch`.
- Catch blocks: log with tag, never re-throw, never send error to group chat.

```ts
try {
  const user = await userRepository.findOrCreate(userId, chatId);
} catch (error) {
  console.error("[DB] findOrCreate failed:", error);
  return; // silent failure
}
```

## Console.log Policy (G11)

- **No `console.log` in committed code.**
- Use `console.error("[TAG] description:", error)` for error logging only.
- Log tags use bracketed uppercase format: `[ERROR]`, `[DB]`, `[SILENCE]`, etc.

## Log Tags

| Tag            | Use when…                                      |
| -------------- | ---------------------------------------------- |
| `[ERROR]`      | Any unexpected error                           |
| `[DB]`         | Database operation failure                     |
| `[SILENCE]`    | User silenced                                  |
| `[UNSILENCE]`  | User unsilenced                                |
| `[PARDON]`     | User pardoned                                  |
| `[BAN SYNC]`   | Ban recorded from external source              |
| `[AUTO-REBAN]` | User with wasBanned:true attempted rejoin      |
| `[WHITELIST]`  | Chat ignored due to whitelist:false            |
| `[FORWARD]`    | Media forwarded to forwardsTo chat             |
| `[DELETE]`     | Message deleted                                |
| `[AUTO-DELETE]`| Bot message auto-deleted after delay           |

## Commenting Rules

- No obvious comments — omit anything that just restates what the code already says.
- Comments must explain **why**, not **what**. If it can be read from the code, don't write it.
- JSDoc on exported functions only when the name + signature aren't self-explanatory.
- TODO comments must include context: `// TODO(#issue): reason`.

## CI Requirements

Every code change must pass all CI steps before being considered complete:

1. **Type check** — `npx tsc --noEmit` — zero errors required.
2. **Format** — `npm run format:check` (Prettier). Run `npm run format` to auto-fix if needed.
3. **Lint** — `npm run lint` (ESLint). No `console.log`, no unused vars, no explicit `any`.
4. **Build** — `npm run build`.
5. **Tests** — `npm test`.

## HTML Escaping

Escape user-provided strings before embedding in HTML replies:

```ts
function esc(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
```
