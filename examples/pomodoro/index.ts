#!/usr/bin/env npx tsx
/**
 * Pomodoro Runner - Minimal single-agent with time budget
 *
 * Proves: one agent + durationIs() + coding tools = useful work in 25min
 *
 * Usage:
 *   npx tsx index.ts "Your task here"
 *   npx tsx index.ts ./task.md
 *
 * Environment:
 *   OPENAI_API_KEY or ANTHROPIC_API_KEY - Your API key
 */

import { RalphLoopAgent, durationIs, costIs, iterationCountIs } from 'ralph-loop-agent';
import { tool } from 'ai';
import { z } from 'zod';
import * as fs from 'fs/promises';
import * as childProcess from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(childProcess.exec);

// Parse CLI args
const taskArg = process.argv[2];
if (!taskArg) {
  console.error('Usage: npx tsx index.ts <task or task-file>');
  console.error('');
  console.error('Examples:');
  console.error('  npx tsx index.ts "Add a hello world function to hello.ts"');
  console.error('  npx tsx index.ts ./task.md');
  process.exit(1);
}

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
const MAX_COST = 2.00; // $2 budget
const MAX_ITERATIONS = 6;

const agent = new RalphLoopAgent({
  model: process.env.ANTHROPIC_API_KEY 
    ? 'anthropic/claude-sonnet-4' 
    : 'openai/gpt-4o',
  instructions: `You are a coding agent with a time budget. Work efficiently.

Guidelines:
1. Read files before modifying them
2. Make incremental changes and verify they work
3. Run tests/commands to verify your changes
4. Use markComplete when the task is done and verified

Be focused - you have limited time and budget.`,
  tools,
  stopWhen: [
    durationIs(POMODORO_MS),
    costIs(MAX_COST),
    iterationCountIs(MAX_ITERATIONS),
  ],
  verifyCompletion: async ({ result }) => {
    // Check if markComplete was called
    for (const step of result.steps) {
      for (const toolResult of step.toolResults) {
        if (toolResult.toolName === 'markComplete') {
          const output = toolResult.output as any;
          if (output?.complete) {
            return { complete: true, reason: output.summary };
          }
        }
      }
    }
    return { 
      complete: false, 
      reason: 'Continue working. Use markComplete when done.' 
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
