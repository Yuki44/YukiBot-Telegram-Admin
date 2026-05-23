# Pull Requests — YukiBot

> Branch naming, PR format, review rules, and merge safety.

## Branch Naming

```
<type>/<short-description>
```

3–4 hyphenated words max. Lowercase.

| Type       | Use when…                   |
| ---------- | --------------------------- |
| `feature`  | New feature or command      |
| `bugfix`   | Bug fix                     |
| `refactor` | Restructuring existing code |
| `docs`     | Documentation only          |
| `chore`    | Tooling, deps, CI, config   |

Examples: `feature/sync-admins-command`, `bugfix/whitelist-bypass-fix`, `docs/update-agents-md`

## PR Title Format

```
TYPE - #PR_NUMBER - Short description of the change
```

Examples:

- `Feature - #42 - Add /syncadmins command`
- `Bugfix - #15 - Fix whitelist bypass on setup`

## PR Description Template

Every PR must include **Changes** and **How to test** sections:

```markdown
#### Changes

- Added / Changed / Fixed [what] so that [why/effect]
- One bullet per logical change, written so a reviewer can follow along
- Focus on what changed in behaviour, not file-by-file diffs

---

#### How to test

1. Step-by-step instructions a reviewer can follow
2. Include specific inputs, expected outputs, and edge cases
3. Use separators (---) to group related test scenarios
```

## Pre-merge Checklist

- [ ] No `console.log` / `console.error` left — only the structured `logger` (G11)
- [ ] No hardcoded chatIds, userIds, or credentials (G2)
- [ ] `wasBanned` is never set to `false` (G3)
- [ ] Admin bypass check is intact (G4)
- [ ] New commands added to the `adminOnlyCommands` set (G7)
- [ ] New features default to `false` (G8)
- [ ] All DB calls in try/catch (G9)
- [ ] Errors logged with `action` tags, not sent to group chat (G10)
- [ ] New user-facing strings live in `src/locales/es.json` (no inlined Spanish)
- [ ] `npm run lint`, `npm run format:check`, `npm test`, and `npm run build` all succeed locally (G13)
- [ ] If the SPA changed: `npm run install:web` ran cleanly and the build produced `web/dist`
- [ ] **Branch is up to date with `main` — no merge conflicts** (see below)
- [ ] **CI is green on the PR's latest commit on GitHub** (see below)

## Remote Verification (do not merge until both pass)

A green local run is not the same as a green PR. Before requesting / approving merge:

### 1. No merge conflicts with `main`

```bash
git fetch origin main
git merge --no-commit --no-ff origin/main   # dry-run; abort with `git merge --abort`
```

If conflicts surface, resolve them on the branch (rebase or merge — match the branch's
prior style) and push. The GitHub PR view must show **"This branch has no conflicts
with the base branch"** before merge.

### 2. CI run on the PR's latest commit succeeded

CI runs against the pushed HEAD, not the local working tree — a passing `npm test`
locally proves nothing if you forgot to push, or if a Node-version / platform-specific
failure only shows up in Actions.

```bash
gh pr checks                       # status of every check on this PR
gh pr view --json statusCheckRollup # full rollup including in-progress
```

All required checks must be `SUCCESS` (or skipped — never `FAILURE` / `PENDING`) on
the latest commit. If a check is flaky, re-run via `gh run rerun <run-id>` rather than
merging through it.

## Merge Rules

- All PRs merge into `main` (triggers Railway auto-deploy).
- Squash merge preferred for clean history.
- Delete branch after merge.
- **Never merge a PR with conflicts or red/pending CI** — Railway auto-deploys from
  `main` and a broken main is a production outage.

## Safety Rules 🛑

Never commit, push, or merge without explicit developer approval.
Always ask before performing any Git write operation.
This applies to all agents — no exceptions.

## Rollback

If a deploy breaks production:

1. Revert the merge commit on `main`.
2. Railway auto-deploys the revert.
3. Investigate on a new branch.
