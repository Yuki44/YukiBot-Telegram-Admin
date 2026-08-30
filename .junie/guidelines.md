# Junie Guidelines — YukiBot

Junie shares the same project context and skills as every other agent in this repo. Nothing here is Junie-specific beyond the pointers below.

## Read first

- [AGENTS.md](../AGENTS.md) — full architecture, entities, feature flags, commands, and the topic-file index. This is the source of truth.
- [CLAUDE.md](../CLAUDE.md) — the condensed rule list (G-numbered invariants). Follow those rules.

## Scratch memory

Start every session by reading `.scratch/memory/INDEX.md` (gitignored; absent means nothing to resume). It indexes the open threads — one file per effort in flight. Maintain it unprompted per [.agents/skills/scratch-memory/SKILL.md](../.agents/skills/scratch-memory/SKILL.md).

## Skills

Reusable procedures live in `.agents/skills/` (single canonical copy, shared with Claude Code and Copilot — no duplication). `.junie/skills/` mirrors them via machine-local junctions. Read a skill's `SKILL.md` when its trigger matches the task. See [AGENTS.md#skills](../AGENTS.md#skills-agentsskills) for the full index.
