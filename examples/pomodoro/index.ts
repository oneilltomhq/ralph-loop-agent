#!/usr/bin/env npx tsx
/**
 * Pomodoro Runner - Minimal single-agent with time budget
 *
 * Proves: one agent + durationIs() + coding tools = useful work in 25min
 *
 * Usage:
 *   npx tsx index.ts "Your task here" [working-dir]
 *   npx tsx index.ts ./task.md [working-dir]
 *
 * Environment:
 *   GEMINI_API_KEY - Google Gemini API key (recommended - fast & cheap)
 *   OPENAI_API_KEY - Or use OpenAI
 *   ANTHROPIC_API_KEY - Or use Anthropic
 */

import { RalphLoopAgent, durationIs, costIs, iterationCountIs } from 'ralph-loop-agent';
import { google } from '@ai-sdk/google';
import { tool } from 'ai';
import { z } from 'zod';
import * as fs from 'fs/promises';
import * as childProcess from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(childProcess.exec);

// Parse CLI args
const taskArg = process.argv[2];
const workDir = process.argv[3] ? process.argv[3].replace('~', process.env.HOME || '') : process.cwd();

if (!taskArg) {
  console.error('Usage: npx tsx index.ts <task or task-file> [working-directory]');
  console.error('');
  console.error('Examples:');
  console.error('  npx tsx index.ts "Add a hello world function to hello.ts"');
  console.error('  npx tsx index.ts ./task.md');
  console.error('  npx tsx index.ts "Read TODO.md and complete tasks" /path/to/repo');
  process.exit(1);
}

// Change to working directory
process.chdir(workDir);
console.log(`Working directory: ${workDir}`);

// Read task from file or use as-is
let task: string;
try {
  await fs.access(taskArg);
  task = await fs.readFile(taskArg, 'utf-8');
  console.log(`Task loaded from: ${taskArg}`);
} catch {
  task = taskArg;
}

// Minimal coding tools (local filesystem, no sandbox)
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
    execute: async ({ path, content }) => {
      try {
        const pathModule = await import('path');
        const dir = pathModule.dirname(path);
        await fs.mkdir(dir, { recursive: true });
        await fs.writeFile(path, content, 'utf-8');
        return { success: true, path };
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    },
  }),

  runCommand: tool({
    description: 'Run a shell command',
    parameters: z.object({
      command: z.string().describe('Shell command to run'),
    }),
    execute: async ({ command }) => {
      try {
        const { stdout, stderr } = await execAsync(command, { maxBuffer: 10 * 1024 * 1024 });
        return { success: true, output: stdout || stderr };
      } catch (error: any) {
        return { success: false, error: error.message, output: error.stdout || error.stderr };
      }
    },
  }),

  listFiles: tool({
    description: 'List files matching a pattern',
    parameters: z.object({
      pattern: z.string().optional().describe('Glob pattern (default: all files)'),
    }),
    execute: async ({ pattern }) => {
      try {
        const cmd = pattern 
          ? `find . -type f -path "*${pattern}*" | grep -v node_modules | grep -v .git | head -50`
          : `find . -type f | grep -v node_modules | grep -v .git | head -50`;
        const { stdout } = await execAsync(cmd);
        return { success: true, files: stdout.trim().split('\n').filter(Boolean) };
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    },
  }),

  markComplete: tool({
    description: 'Mark the task as complete with a summary',
    parameters: z.object({
      summary: z.string().describe('Summary of what was accomplished'),
    }),
    execute: async ({ summary }) => {
      return { complete: true, summary };
    },
  }),
};

// Configure agent with pomodoro-style stop policy
const POMODORO_MS = 25 * 60 * 1000; // 25 minutes
const MAX_COST = 50.00; // $50 budget (generous for testing)
const MAX_ITERATIONS = 50; // Allow many iterations to hit duration limit

// Model selection - prefer minimax via OpenRouter (cheapest)
let model: any;
if (process.env.OPENROUTER_API_KEY) {
  const { createOpenAI } = await import('@ai-sdk/openai');
  const openrouter = createOpenAI({
    apiKey: process.env.OPENROUTER_API_KEY,
    baseURL: 'https://openrouter.ai/api/v1',
    compatibility: 'strict', // Force chat completions format
  });
  model = openrouter('minimax/minimax-m2.5');
  console.log('Model: minimax-m2.5 (via OpenRouter)');
} else if (process.env.GOOGLE_GENERATIVE_AI_API_KEY || process.env.GEMINI_API_KEY) {
  model = google('gemini-2.5-pro');
  console.log('Model: gemini-2.5-pro (via Google AI)');
} else if (process.env.OPENAI_API_KEY) {
  const { createOpenAI } = await import('@ai-sdk/openai');
  const openai = createOpenAI({ apiKey: process.env.OPENAI_API_KEY });
  model = openai('gpt-4o-mini');
  console.log('Model: gpt-4o-mini (via OpenAI)');
} else {
  console.error('Error: Set OPENROUTER_API_KEY, GOOGLE_GENERATIVE_AI_API_KEY, or OPENAI_API_KEY');
  process.exit(1);
}

const agent = new RalphLoopAgent({
  model,
  instructions: `You are a coding agent with a 25-minute time budget. Your goal is to maximize useful work done in that time.

## CRITICAL: Run For Full 25 Minutes

- You have a HARD STOP at 25 minutes — work until the duration limit is hit
- Do NOT call markComplete until the very end when time is running out
- Complete as many tasks as possible in sequence
- When you finish a task, immediately pick the next one and keep working

## Workflow (REPEAT until time runs out)

1. **Read the backlog** — Look for TODO.md, ROADMAP.md
2. **Pick ONE task** — Lowest-numbered incomplete item
3. **Complete it** — Make changes, verify they work
4. **Update roadmap** — Mark item complete, add findings
5. **PICK NEXT TASK IMMEDIATELY** — Don't stop, keep going!
6. **If roadmap is done** — Check README.md, LAB.md for new work
7. **Create new items** — Add to ROADMAP.md and complete them
8. **Only call markComplete** — When you sense time is almost up (many iterations done)

## What To Do If You Run Out Of Roadmap

- Read README.md and LAB.md for project direction
- Look at the codebase for obvious improvements
- Create new ROADMAP items for features, tests, docs, refactoring
- Keep working until the duration limit forces you to stop

## DO NOT

- Do NOT call markComplete after each task — save it for the end
- Do NOT stop early because you completed a few tasks
- Do NOT wait for user input — work autonomously

Be productive. Keep working. The experiment depends on you running for ~25 minutes.`,
  tools,
  stopWhen: [
    durationIs(POMODORO_MS),
    costIs(MAX_COST, { inputCostPerMillionTokens: 0.2, outputCostPerMillionTokens: 0.2 }), // minimax pricing
    iterationCountIs(MAX_ITERATIONS),
  ],
  verifyCompletion: async ({ result }) => {
    // Don't exit just because markComplete was called - let the stop conditions handle that
    // This allows the agent to keep working through multiple tasks
    let hasMarkedComplete = false;
    for (const step of result.steps) {
      for (const toolResult of step.toolResults) {
        if (toolResult.toolName === 'markComplete') {
          hasMarkedComplete = true;
          // Don't return complete: true here - let duration/cost/iteration limits control when to stop
        }
      }
    }
    if (hasMarkedComplete) {
      console.log('  → Task complete, continuing to next task...');
    }
    return { 
      complete: false, 
      reason: 'Continue working. More tasks available.' 
    };
  },
});

// Run the agent
console.log('\n╭───────────────────────────────────────────────────────────────╮');
console.log('│  POMODORO RUNNER                                              │');
console.log('╰───────────────────────────────────────────────────────────────╯');
console.log(`\nTask: ${task.slice(0, 200)}${task.length > 200 ? '...' : ''}`);
console.log(`\nStop policy: duration=${POMODORO_MS/60000}min, cost=$${MAX_COST}, iterations=${MAX_ITERATIONS}`);
console.log('\nStarting...\n');

const startTime = Date.now();
const result = await agent.loop({ prompt: task });
const totalDuration = Date.now() - startTime;

// Print summary
console.log('\n╭───────────────────────────────────────────────────────────────╮');
console.log('│  RESULT                                                       │');
console.log('╰───────────────────────────────────────────────────────────────╯');
console.log(`\nCompletion: ${result.completionReason}`);
console.log(`Iterations: ${result.iterations}`);
console.log(`Duration: ${Math.round(totalDuration / 1000)}s (${(totalDuration / 60000).toFixed(2)} min)`);
console.log(`Tokens: in=${result.totalUsage.inputTokens ?? 0}, out=${result.totalUsage.outputTokens ?? 0}`);
console.log(`\nSummary: ${result.reason || 'N/A'}`);
console.log(`\nFinal output:\n${result.text.slice(0, 500)}${result.text.length > 500 ? '...' : ''}`);
