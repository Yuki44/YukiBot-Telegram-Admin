---
name: scratch-memory
description: Persist and resume the decisions of work in flight. Use at the start of every session to check for resumable threads, whenever a decision, constraint, rejected option, or plan change is settled, when the user says "continue", switches model/agent/tool mid-effort, or when a grilling/design/planning discussion concludes.
---

Context windows compact, machines reboot, sessions end, and the human switches models and tools mid-effort. Each of those silently drops the **decisions** behind the work — the choices, the reasons, the roads not taken — while the code, if any exists yet, keeps none of them. A **thread** is the antidote: a small, living, gitignored file holding one effort's decisions, written as they are made, so any agent in any tool can pick the effort up cold.

A thread holds **decisions, not transcript**. It is the _why_ — reasons, rejected options, constraints, the next step — never a replay of the conversation and never a restatement of what the diff already shows.

Threads live in `.scratch/memory/` at the repo root, gitignored, never committed. Create the directory when the first thread needs it.

## Fire without being asked

The human never says "write this down". The agent maintains the memory as a background reflex, narrating in one line what it wrote — `→ scratch: recorded <decision> in <thread>` — and moving on.

## Session start: resume

Run before the first substantive reply of a session, once.

1. Read `.scratch/memory/INDEX.md`. Absent or empty — nothing to resume; carry on with the session and create threads as decisions arrive.
2. Match the human's opening message against the open threads. A clear match, or a bare "continue" with exactly one open thread — load that thread and state in one line where the effort stands and what the next step is.
3. Ambiguous — more than one open thread and no clear match — list the open threads by title and ask which to continue.
4. Run the [sweep](#sweep).

**Completion criterion:** the index has been read, and either a thread is loaded or the session is knowingly starting fresh.

## During the session: capture

Append to the thread the moment any of these lands — not at the end of the session, which may never come:

- a **decision** is settled, with the reason it beat the alternatives
- an option is **rejected**, with why
- a **constraint** is stated (a guardrail, a deadline, a dependency, a "must never")
- the **plan changes**, or a decision already recorded is reversed — strike the old line and record the reversal with its reason
- an **open question** is raised or answered
- the **next step** changes

Start a new thread on the first such moment for an effort that has none. Slug the title in kebab-case: `.scratch/memory/<slug>.md`. Before creating it, grep `.scratch/memory/archive/` for a related slug and, on a hit, record it as `Prior context` — a bug in shipped work is a fresh thread carrying a pointer to the archived one, never a reopening.

Discussing several efforts in one session means several threads, one per effort; each capture lands in its own.

Every write updates the thread's `Last touched` date and its one-line summary in `INDEX.md`.

**Consolidate, don't accrete.** A thread stays cheap enough to load whole. When one grows past roughly a screen, fold superseded lines into the decision that replaced them and delete detail the code or PR now carries. Growth belongs in the decisions, not in the prose around them.

**Completion criterion:** every decision, rejection, constraint, and reversal from this session appears in a thread, and no conversational filler does.

## Sweep

Keeps the memory a live workspace rather than a graveyard. Run once at session start.

- **Shipped** — the thread's branch or PR is merged into `main` (`gh pr view <n> --json state,mergedAt`, or `git branch --merged main`). Move the file to `.scratch/memory/archive/`, stamp `Shipped: <date>`, drop it from `INDEX.md`. Automatic; report it, don't ask.
- **Archived and cold** — an archived thread stamped more than **7 days** ago. Delete it. Automatic. Its window exists for the same-week bug fix; past that the PR and git history carry it.
- **Stale and unshipped** — a live thread untouched for more than **7 days**. Ask before removing: name it, summarise it in one line, offer to keep, archive, or delete. The human decides.

Archives are **immutable**. A later decision that contradicts an archived one is a new decision in a new thread.

## Templates

`INDEX.md` — the whole memory at a glance, so a resuming agent loads one small file before choosing what else to read:

```markdown
# Scratch memory

Open threads. Detail lives in each thread file, never here.

| Thread  | File                   | Status    | Last touched | Where it stands |
| ------- | ---------------------- | --------- | ------------ | --------------- |
| <Title> | [<slug>.md](<slug>.md) | exploring | 2026-08-01   | <one line>      |
```

A thread — `Status` is one of `exploring`, `decided`, `building`, `blocked`, `shipped`:

```markdown
# <Title>

Status: exploring · Started: <date> · Last touched: <date>
Branch: <branch or —> · PR: <#n or —>
Prior context: <archive/<slug>.md, only when this continues shipped work>

## Goal

<what we are building and, in a line, why it is worth building>

## Decisions

- <date> — <decision>, because <reason>

## Rejected

- <option> — <why it lost>

## Constraints

- <guardrail, dependency, or must-never that bounds the work>

## Open questions

- <question still unanswered>

## Next step

<the single thing to do next>
```
