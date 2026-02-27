# Pomodoro Runner

Autonomous coding agent with a time budget. Uses the `.pomodoro/` convention for task management.

## Quick Start

```bash
cd examples/pomodoro
pnpm install

# Point at any project — it will bootstrap .pomodoro/backlog.md if needed
GOOGLE_GENERATIVE_AI_API_KEY=... npx tsx index.ts /path/to/your/repo

# Shorter session
GOOGLE_GENERATIVE_AI_API_KEY=... npx tsx index.ts /path/to/repo --duration 10

# Different model
OPENROUTER_API_KEY=... npx tsx index.ts /path/to/repo --model minimax/minimax-m2.5
```

## How It Works

1. Agent checks for `.pomodoro/backlog.md` in the working directory
2. If missing, bootstraps one from TODO.md, ROADMAP.md, README.md, code TODOs
3. Picks the top unchecked task from the **Active** section
4. Works on it: reads code, makes changes, verifies
5. Updates the backlog (checks off done, adds discovered tasks)
6. Picks the next task. Repeats until time/cost/iteration limit.
7. Writes a session report to `.pomodoro/sessions/`

See [CONVENTION.md](CONVENTION.md) for the full `.pomodoro/` spec.

## Options

| Flag | Default | Description |
|------|---------|-------------|
| `[working-dir]` | `.` | Project directory to work in |
| `--duration N` | `25` | Session length in minutes |
| `--model NAME` | auto | Model name or alias (`gemini`, `minimax`) |
| `--max-cost N` | `50` | Dollar budget |
| `--max-iterations N` | `50` | Max loop iterations |

## Earlier Test Results (pre-convention)

Before the `.pomodoro/` convention, the runner used a hardcoded prompt
that referenced project-specific files (TODO.md, ROADMAP.md, LAB.md).

### Key Finding: `verifyCompletion`

The critical fix was making `verifyCompletion` always return `false` so
that `durationIs()` / `costIs()` / `iterationCountIs()` control when
the loop exits — not the agent calling `markComplete`.

### Test Runs (crush repo, gemini-2.5-pro)

| Run | Duration | Iterations | Result |
|-----|----------|------------|--------|
| 1 | 1.5 min | 1 | M0 tests |
| 2 | 3.4 min | 2 | M1 browser commands |
| 3 | 2.8 min | 2 | More M1 |
| 4 | 4.3 min | 2 | M1 complete (still exiting early) |
| 5* | ~15 min | Many | M1 + M2 + started M3 |

\* After the `verifyCompletion` fix.

### OpenRouter / minimax Issue

`@ai-sdk/openai` v2+ uses OpenAI's Responses API (`/responses` endpoint)
which OpenRouter doesn't support. Use `compatibility: 'strict'` to force
chat completions format. This may still have issues depending on SDK version.
