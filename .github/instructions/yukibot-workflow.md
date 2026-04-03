# YukiBot Workflow — Middleware, Features & Commands

> Middleware flow, feature flags, command registration, and helper usage.
> Auto-loaded by GitHub Copilot when editing `src/**` files.

## Chat Types

- **Topics-type chats** — forums with per-topic content rules (topicFiltering feature).
- **Normal chats** — standard groups with shared moderation features.
- **Administration channels** — log channels (`logsTo`) and forward targets (`forwardsTo`).

## Middleware Order (critical — do not reorder)

```
loadChat → trackUser → isAdmin → adminOnlyCommands → feature handlers
```

Registered in `src/index.ts`:

```ts
bot.use(loadChat);     // loads Chat doc, enforces whitelist
bot.use(trackUser);    // upserts User doc for every message sender
bot.use(isAdmin);      // sets ctx.isAdmin (DB + Telegram API fallback)
bot.use(adminOnlyCommands); // deletes non-admin command messages
```

### loadChat

- Sets `ctx.chatConfig` from DB.
- If `whitelist: false` → sets `chatConfig = null` (bot ignores chat).
- `/setup` bypasses whitelist — it works even without a Chat doc.

### adminOnlyCommands

- Deletes messages from non-admins that use a registered YukiBot command.
- Only YukiBot's own commands should be matched — other bots' commands (`/start@otherbot`) must be left alone.
- `/setup` bypasses this check (handled in the setup command itself).

## Feature Flags

Stored in `Chat.features`. **All default to `false`** (G8).

Toggled via `/togglefeature` (owner only) or MongoDB Compass.

Feature handlers must guard on the flag before acting:

```ts
if (!ctx.chatConfig?.features.topicFiltering) return next();
```

## Adding a New Command

1. Create `src/bot/commands/<name>.ts` — export `<name>Handler`.
2. Register in `src/index.ts`: `bot.command("<name>", <name>Handler);`
3. Add the command string to `adminOnlyCommands` protected list (G7).
4. Bot replies in **Spanish only**.
5. Use `sendAndAutoDelete()` for ephemeral confirmations.

## resolveTarget() — User Resolution

Priority order:
1. **Explicit arg** — text_mention entity or numeric ID overrides reply.
2. **Reply** — `reply_to_message.from` (only when no explicit target in args).
3. **text_mention entity** — Telegram autocomplete, full user object.
4. **@username** — DB cache lookup (User → Admin collection).
5. **Numeric ID** — `getChatMember` API call, graceful fallback.

Returns `null` if unresolvable — always check.

```ts
const target = await resolveTarget(ctx, args);
if (!target) {
  await sendAndAutoDelete(ctx, "⚠️ No pude identificar al usuario.", 5000);
  return;
}
```

## applyWarn() — Warning Logic

Handles 1/3 → 2/3 → 3/3 auto-ban cycle. **Always reuse — never inline.**

```ts
await applyWarn(ctx, target.userId, chatId, target.name, target.username, reason);
```

## sendAndAutoDelete() — Ephemeral Messages

Send + auto-delete after delay. Use for all confirmations in group chats.

```ts
await sendAndAutoDelete(ctx, "✅ Hecho.", 1000);
```

## silenceUser() / unsilenceUser()

- `silenceUser(ctx, userId, chatId)` — restricts for 1 week, verifies via API.
- `unsilenceUser(ctx, userId, chatId)` — lifts restriction.

Both return `boolean` (success/failure) and wrap calls in try/catch.
