# `.pomodoro/` Convention

A lightweight, file-based task management convention for autonomous agent sessions.

No SaaS. No API. Just markdown files in your repo that agents can read, write, and diff.

## Directory Structure

```
.pomodoro/
  backlog.md              ← ordered task list
  sessions/
    2026-02-26T19-23.md   ← auto-generated session report
    2026-02-26T20-01.md
```

## `backlog.md` Format

```markdown
# Backlog

Tasks are ordered by priority (top = most important).
The agent picks the top unchecked item.

## Active

- [ ] Add error handling to CDP commands
  > src/cdp.ts throws raw errors, needs try/catch with typed CdpError

- [ ] Screenshot command should save to file
  > Currently returns base64. Add --output flag.
  > See src/commands.ts screenshot()

- [ ] Refactor shell.ts to use command registry pattern
  > Extract each command into its own function. Current switch statement is 300+ lines.

## Blocked

- [ ] WebSocket reconnection logic
  > Blocked: needs upstream fix in ghostty-web fork (issue #12)

## Done

- [x] Wire AbortController into ProgramContext
  > Done: 2026-02-26 · session: 2026-02-26T19-23

- [x] Add Vitest harness with initial tests
  > Done: 2026-02-26 · session: 2026-02-26T19-23
```

### Rules

- **`## Active`** — tasks the agent should work on, in priority order
- **`## Blocked`** — tasks that can't be done yet, with reason
- **`## Done`** — completed tasks, kept for history
- **`> ` blockquotes** — context, notes, acceptance criteria
- The agent moves tasks between sections as it works
- Standard markdown checkboxes: `- [ ]` todo, `- [x]` done

## Session Reports

The agent writes a session report when it finishes. Filename is the ISO timestamp of when the session started.

```markdown
# Session 2026-02-26T19-23

Model: gemini-2.5-pro
Duration: 24m 38s
Iterations: 12
Tokens: 1.2M in / 45K out

## Completed

- [x] Add error handling to CDP commands
  > Wrapped all CDP calls in try/catch, added CdpError class.
  > Changed: src/cdp.ts, src/errors.ts (new)

- [x] Screenshot command saves to file
  > Added --output flag, defaults to stdout base64.
  > Changed: src/commands.ts

## Attempted

- [ ] Refactor shell.ts to use command registry pattern
  > Started extracting commands. Got through 4 of 12.
  > Partial: src/shell.ts, src/commands/*.ts (new dir)
  > Ran out of time.

## Discovered

- [ ] `listFiles` tool doesn't handle symlinks
  > Found while testing — added to backlog.

## Blockers Found

- WebSocket reconnection: confirmed ghostty-web issue, no workaround.

## Files Changed

src/cdp.ts
src/errors.ts (new)
src/commands.ts
src/shell.ts
src/commands/cat.ts (new)
src/commands/grep.ts (new)
src/commands/head.ts (new)
src/commands/tail.ts (new)
```

## Bootstrap

If a project doesn't have `.pomodoro/backlog.md`, the agent creates one by scanning for:

1. `TODO.md`, `ROADMAP.md`, `TODO`, `CHANGELOG.md` — existing task sources
2. `README.md` — project goals and direction
3. GitHub issues (if `gh` CLI available)
4. Code TODOs: `grep -r 'TODO\|FIXME\|HACK\|XXX' --include='*.ts' ...`

The bootstrap step produces an initial `backlog.md` from whatever it finds, then starts working from it.

## Why This Works

- **Zero dependencies** — just files, readable by any tool
- **Version controlled** — `git diff` shows task status changes alongside code changes
- **Agent-native** — `readFile` + `writeFile` is all you need
- **Human-friendly** — it's just markdown, edit it in any editor
- **Diffable history** — session reports are permanent records of what each pomodoro accomplished
- **Composable** — OpenClaw (or any orchestrator) can populate the backlog from chat, then trigger a session
