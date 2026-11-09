---
name: manage-task-context
description: 维护多轮任务的中央 TASK_STATE.md、会话归档和检查点；用于有持续状态的任务、恢复或历史回溯。
---

# Manage Task Context

Keep authoritative task state outside the chat window. Treat chat summaries as disposable caches, never as the only copy of requirements or decisions.

## Start or Resume a Task

1. Run `node scripts/context_archive.mjs sync --current`.
   For Hermes history catch-up, run `python scripts/hermes_sqlite_export.py`; it reads `state.db` in read-only mode and writes searchable user/assistant projections.
2. Run `node scripts/task_state.mjs ensure --platform codex --session "$env:CODEX_THREAD_ID" --workspace "$PWD"`.
3. Read the returned `TASK_STATE.md` before planning or changing files.
4. Run `node scripts/task_state.mjs status --platform codex --session "$env:CODEX_THREAD_ID"` and note whether a 20-turn checkpoint is due.

Use the central path under `~/Documents/AI任务记忆/tasks/codex/<thread-id>/TASK_STATE.md`. Do not add state files to the user's repository unless the user asks for a project-local mirror.

If the user switches ChatGPT accounts in the same desktop app, keep using this local state by default. The archive marks `AI_CONTEXT_PROFILE` as `shared` unless the operator sets a different value. Use a separate `AI_CONTEXT_HOME` only when account histories must be isolated rather than shared.

## Maintain the Canonical State

Read [task-state-schema.md](references/task-state-schema.md) before creating or substantially rewriting state.

Update `TASK_STATE.md` when any of these happens:

- a requirement, constraint, acceptance criterion, or user preference changes;
- a technical decision, file path, command, test result, blocker, or failure becomes material;
- 20 additional user turns have accumulated;
- the task changes topic or phase;
- before compaction, handoff, restart, or a final deliverable.

Preserve stable IDs such as `R-001`, `AC-001`, and `D-001`. Never silently drop an unresolved requirement or decision. Mark it superseded with a reason when it is no longer active.

After editing, run:

```
node scripts/task_state.mjs validate --platform codex --session "$env:CODEX_THREAD_ID"
node scripts/task_state.mjs checkpoint --platform codex --session "$env:CODEX_THREAD_ID"
```

Only mark a checkpoint after the state is accurate.

## Retrieve Historical Detail

Do not inject complete transcripts into the model. Retrieve history only when current state and recent turns are insufficient.

Choose the cheapest adequate lane:

- exact identifiers, names, numbers, commands, or quoted wording: `qmd search "..." -c ai-task-transcripts -n 5`;
- conceptual recall in Chinese or paraphrased questions: `qmd vsearch "..." -c ai-task-transcripts -n 5`;
- important ambiguous questions: `qmd query "..." -c ai-task-transcripts -n 5`.

Fetch at most three to five results, verify decisive claims against the cited transcript path, and inject only the relevant excerpt. If qmd is unavailable, run `node scripts/context_archive.mjs search --query "..." --limit 5` for the local lexical fallback.

## Information Layers

Use these layers in order:

1. `TASK_STATE.md`: compact authoritative requirements, execution state, and technical facts.
2. Recent 8-20 turns: current working set.
3. Retrieved transcript excerpts: historical evidence on demand.
4. Original Codex JSONL or Hermes SQLite/export: immutable source of truth for verification.

Never store secrets, system instructions, developer instructions, hidden reasoning, or bulk tool output in the searchable transcript projection. The original application stores remain untouched.

## Compaction Safety

Before compaction, update and validate the task state. After compaction, re-read it, compare the active request and next actions, and retrieve source excerpts for anything uncertain. A compaction summary may help navigation but must not overwrite canonical state.
