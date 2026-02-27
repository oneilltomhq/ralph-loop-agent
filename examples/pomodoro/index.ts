#!/usr/bin/env npx tsx
/**
 * Pomodoro Runner — autonomous agent with a time budget
 *
 * Uses the .pomodoro/ convention for task management.
 * See CONVENTION.md for the full spec.
 *
 * Usage:
 *   npx tsx index.ts [working-dir] [--duration 25] [--model gemini-2.5-pro]
 *   npx tsx index.ts /path/to/repo
 *   npx tsx index.ts /path/to/repo --duration 10
 *
 * Environment:
 *   GOOGLE_GENERATIVE_AI_API_KEY — Google Gemini (default)
 *   OPENROUTER_API_KEY — OpenRouter (minimax, etc.)
 *   OPENAI_API_KEY — OpenAI
 */

import { RalphLoopAgent, durationIs, costIs, iterationCountIs } from 'ralph-loop-agent';
import { google } from '@ai-sdk/google';
import { tool } from 'ai';
import { z } from 'zod';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as childProcess from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(childProcess.exec);

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

function parseArgs() {
  const args = process.argv.slice(2);
  let workDir = process.cwd();
  let durationMin = 25;
  let modelOverride: string | undefined;
  let maxCost = 50;
  let maxIterations = 50;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--duration' && args[i + 1]) {
      durationMin = parseInt(args[++i], 10);
    } else if (args[i] === '--model' && args[i + 1]) {
      modelOverride = args[++i];
    } else if (args[i] === '--max-cost' && args[i + 1]) {
      maxCost = parseFloat(args[++i]);
    } else if (args[i] === '--max-iterations' && args[i + 1]) {
      maxIterations = parseInt(args[++i], 10);
    } else if (!args[i].startsWith('--')) {
      workDir = args[i].replace('~', process.env.HOME || '');
    }
  }

  return { workDir, durationMin, modelOverride, maxCost, maxIterations };
}

const { workDir, durationMin, modelOverride, maxCost, maxIterations } = parseArgs();

process.chdir(workDir);
console.log(`Working directory: ${workDir}`);

// ---------------------------------------------------------------------------
// Session metadata
// ---------------------------------------------------------------------------

const sessionId = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16);
const sessionReportPath = `.pomodoro/sessions/${sessionId}.md`;

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

const tools = {
  readFile: tool({
    description: 'Read a file from the filesystem',
    parameters: z.object({
      path: z.string().describe('File path to read'),
    }),
    execute: async ({ path }) => {
      try {
        const content = await fs.readFile(path, 'utf-8');
        return { success: true, content };
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    },
  }),

  writeFile: tool({
    description: 'Write a file to the filesystem (creates directories if needed)',
    parameters: z.object({
      path: z.string().describe('File path to write'),
      content: z.string().describe('Content to write'),
    }),
    execute: async ({ path: filePath, content }) => {
      try {
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        await fs.writeFile(filePath, content, 'utf-8');
        return { success: true, path: filePath };
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    },
  }),

  runCommand: tool({
    description: 'Run a shell command and return stdout/stderr',
    parameters: z.object({
      command: z.string().describe('Shell command to run'),
    }),
    execute: async ({ command }) => {
      try {
        const { stdout, stderr } = await execAsync(command, {
          maxBuffer: 10 * 1024 * 1024,
          timeout: 60_000,
        });
        return { success: true, output: stdout || stderr };
      } catch (error: any) {
        return { success: false, error: error.message, output: error.stdout || error.stderr };
      }
    },
  }),

  listFiles: tool({
    description: 'List files in the project (excludes node_modules, .git, dist)',
    parameters: z.object({
      pattern: z.string().optional().describe('Filter pattern (substring match)'),
    }),
    execute: async ({ pattern }) => {
      try {
        const cmd = pattern
          ? `find . -type f -path "*${pattern}*" | grep -v node_modules | grep -v .git | grep -v dist | head -80`
          : `find . -type f | grep -v node_modules | grep -v .git | grep -v dist | head -80`;
        const { stdout } = await execAsync(cmd);
        return { success: true, files: stdout.trim().split('\n').filter(Boolean) };
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    },
  }),
};

// ---------------------------------------------------------------------------
// System prompt — the .pomodoro/ convention, generic
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are a focused coding agent running a timed pomodoro session.
You will be stopped automatically when time runs out. Work until then.

## How You Work

This project may use a \`.pomodoro/\` convention for task management.

### If \`.pomodoro/backlog.md\` exists:

1. Read it. The top unchecked item in the **Active** section is your current task.
2. Work on that ONE task — read relevant code, make changes, verify.
3. When done, update the backlog: check it off, move it to **Done**, note what you did.
4. Pick the next unchecked item. Repeat.
5. If you find new work or blockers, add them to the appropriate section.

### If \`.pomodoro/backlog.md\` does NOT exist:

Bootstrap it:
1. Look for existing task sources: TODO.md, ROADMAP.md, README.md, CHANGELOG.md
2. Scan for code TODOs: \`grep -rn 'TODO\\|FIXME\\|HACK' --include='*.ts' --include='*.js' --include='*.py' --include='*.go' . | head -30\`
3. Examine the project structure to understand what it does
4. Create \`.pomodoro/backlog.md\` with tasks organised into **Active**, **Blocked**, and **Done** sections
5. Then start working through the Active items

### Backlog format:

\`\`\`markdown
# Backlog

## Active

- [ ] Task title
  > Context, notes, acceptance criteria

## Blocked

- [ ] Task title
  > Blocked: reason

## Done

- [x] Task title
  > Done: YYYY-MM-DD · what was done
\`\`\`

## Working On Each Task

- Focus on ONE task at a time
- Read the relevant code before changing it
- Make incremental changes and verify they work (run tests, build, etc.)
- If a task is too large, break it into subtasks in the backlog first
- If a task is blocked, move it to **Blocked** with a reason, then pick the next one

## Session Report

When you sense time is almost up (you've done many iterations), write a session report to:
\`${sessionReportPath}\`

Format:
\`\`\`markdown
# Session ${sessionId}

Model: [model name]
Duration: [time]
Iterations: [count]

## Completed

- [x] Task title
  > What was done. Files changed.

## Attempted

- [ ] Task title
  > How far you got. What's left.

## Discovered

- [ ] Any new tasks found during work

## Blockers Found

- Description of anything that blocked progress

## Files Changed

- list of files
\`\`\`

## Rules

- Do NOT stop early. Work until the time limit forces you to stop.
- Do NOT ask for user input. You are autonomous.
- Do NOT rush through tasks to tick boxes. Quality > quantity.
- DO verify your changes work before marking a task done.
- DO update .pomodoro/backlog.md as you go — it is the source of truth.
`;

// ---------------------------------------------------------------------------
// Model selection
// ---------------------------------------------------------------------------

async function selectModel(override?: string): Promise<{ model: any; name: string }> {
  if (override === 'minimax' || (!override && process.env.OPENROUTER_API_KEY)) {
    const { createOpenAI } = await import('@ai-sdk/openai');
    const openrouter = createOpenAI({
      apiKey: process.env.OPENROUTER_API_KEY,
      baseURL: 'https://openrouter.ai/api/v1',
      compatibility: 'strict',
    });
    const name = override || 'minimax/minimax-m2.5';
    return { model: openrouter(name), name };
  }

  if (override === 'gemini' || (!override && (process.env.GOOGLE_GENERATIVE_AI_API_KEY || process.env.GEMINI_API_KEY))) {
    const name = 'gemini-2.5-pro';
    return { model: google(name), name };
  }

  if (process.env.OPENAI_API_KEY) {
    const { createOpenAI } = await import('@ai-sdk/openai');
    const openai = createOpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const name = override || 'gpt-4o-mini';
    return { model: openai(name), name };
  }

  console.error('Error: Set GOOGLE_GENERATIVE_AI_API_KEY, OPENROUTER_API_KEY, or OPENAI_API_KEY');
  process.exit(1);
}

const { model, name: modelName } = await selectModel(modelOverride);
console.log(`Model: ${modelName}`);

// ---------------------------------------------------------------------------
// Agent
// ---------------------------------------------------------------------------

const POMODORO_MS = durationMin * 60 * 1000;

const agent = new RalphLoopAgent({
  model,
  instructions: SYSTEM_PROMPT,
  tools,
  stopWhen: [
    durationIs(POMODORO_MS),
    costIs(maxCost, { inputCostPerMillionTokens: 0.2, outputCostPerMillionTokens: 0.2 }),
    iterationCountIs(maxIterations),
  ],
  verifyCompletion: async ({ result }) => {
    // Never exit early — let stop conditions (duration/cost/iterations) control termination.
    // Log when the agent thinks it's done so we can see it in the console.
    for (const step of result.steps) {
      for (const toolResult of step.toolResults) {
        if (toolResult.toolName === 'writeFile') {
          const output = toolResult.output as any;
          if (output?.path?.includes('.pomodoro/sessions/')) {
            console.log('  → Session report written');
          }
        }
      }
    }
    return {
      complete: false,
      reason: 'Continue working. Pick the next task from the backlog.',
    };
  },
});

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

console.log('\n╭───────────────────────────────────────────────────────────────╮');
console.log('│  POMODORO RUNNER                                              │');
console.log('╰───────────────────────────────────────────────────────────────╯');
console.log(`\nSession:    ${sessionId}`);
console.log(`Model:      ${modelName}`);
console.log(`Duration:   ${durationMin} min`);
console.log(`Max cost:   $${maxCost}`);
console.log(`Iterations: ${maxIterations} max`);
console.log(`Report:     ${sessionReportPath}`);
console.log('\nStarting...\n');

const startTime = Date.now();
const result = await agent.loop({
  prompt: 'Begin your pomodoro session. Start by checking for .pomodoro/backlog.md — if it exists, read it and start working. If not, bootstrap one from the project.',
});
const totalDuration = Date.now() - startTime;

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log('\n╭───────────────────────────────────────────────────────────────╮');
console.log('│  RESULT                                                       │');
console.log('╰───────────────────────────────────────────────────────────────╯');
console.log(`\nSession:    ${sessionId}`);
console.log(`Completion: ${result.completionReason}`);
console.log(`Iterations: ${result.iterations}`);
console.log(`Duration:   ${Math.round(totalDuration / 1000)}s (${(totalDuration / 60000).toFixed(1)} min)`);
console.log(`Tokens:     in=${result.totalUsage.inputTokens ?? 0}, out=${result.totalUsage.outputTokens ?? 0}`);
console.log(`\nReason: ${result.reason || 'N/A'}`);

// Check if session report was written
try {
  await fs.access(sessionReportPath);
  console.log(`\nSession report: ${sessionReportPath}`);
} catch {
  console.log('\nNo session report written (agent may have run out of time).');
  // Write a minimal one ourselves
  const minimalReport = `# Session ${sessionId}\n\nModel: ${modelName}\nDuration: ${Math.round(totalDuration / 1000)}s\nIterations: ${result.iterations}\nCompletion: ${result.completionReason}\n\n_Agent did not write a session report. Check git diff for changes._\n`;
  await fs.mkdir(path.dirname(sessionReportPath), { recursive: true });
  await fs.writeFile(sessionReportPath, minimalReport, 'utf-8');
  console.log(`Wrote minimal report: ${sessionReportPath}`);
}

console.log(`\nFinal output:\n${result.text.slice(0, 500)}${result.text.length > 500 ? '...' : ''}`);
