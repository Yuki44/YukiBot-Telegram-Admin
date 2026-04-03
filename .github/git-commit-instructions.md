# Git Commit Instructions — YukiBot

> Commit message format for all contributors and AI agents.

## Format

Single-line only. No body.

```
reason(where): how
```

## Reason

| Reason     | Use when…                                   |
| ---------- | ------------------------------------------- |
| `fix`      | Bug fix                                     |
| `feat`     | New feature or command                      |
| `refactor` | Code change that doesn't add/fix features   |
| `change`   | Behavior change to existing feature         |
| `style`    | Formatting, whitespace, missing semicolons  |

## Where

Component or feature name. ≤ 3 words, hyphen-separated.

Examples: `admin-commands`, `topic-filtering`, `resolve-target`, `middleware`, `mongo-db`

## How

Imperative present tense. < 50 characters.

## Deriving the message from the diff

The commit message must describe the **actual diff** — not the user's request. You can help yourself with the task description, but the diff is the priority. 
Before writing the message:

1. Review every file in the staged diff.
2. Identify the single most meaningful change (or the common theme across changes).
3. Write `reason`, `where`, and `how` based on that, not on assumptions.

## Before committing — always ask

Propose the commit message to the developer and **wait for explicit approval** before running `git commit`. No exceptions.

Example:

> Proposed commit: `fix(admin-only): skip non-yukibot slash commands`
> Shall I proceed?

## Examples

```
feat(sync-admins): add syncadmins command
```

```
fix(admin-only): skip non-yukibot commands
```

```
refactor(resolve-target): extract mention parser
```

```
change(silence): extend duration to two weeks
```

```
style(helpers): fix inconsistent spacing
```
