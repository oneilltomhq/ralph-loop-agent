# Pomodoro Runner - Layer 1 Results

## Setup

Location: `examples/pomodoro/`

Stop policy: `[durationIs(25min), costIs($2), iterationCountIs(6)]`

## Running

```bash
cd examples/pomodoro
ANTHROPIC_API_KEY=sk-... npx tsx index.ts "Your task here"
# or
OPENAI_API_KEY=sk-... npx tsx index.ts "Your task here"
```

## Test Runs

### Task 1: [Description]
- **Prompt**: 
- **Result**: 
- **Stop condition hit**: duration / cost / iterations
- **Iterations**: 
- **Actual duration**: 
- **Stayed on task?**: 
- **Notes**:

### Task 2: [Description]
- **Prompt**: 
- **Result**: 
- **Stop condition hit**: 
- **Iterations**: 
- **Actual duration**: 
- **Stayed on task?**: 
- **Notes**:

### Task 3: [Description]
- **Prompt**: 
- **Result**: 
- **Stop condition hit**: 
- **Iterations**: 
- **Actual duration**: 
- **Stayed on task?**: 
- **Notes**:

## Observations

### Does `durationIs` fire before `costIs`?
- Ratio tells if over/under-budgeted

### Does `verifyCompletion` catch incomplete work?
- 

### Agent behavior patterns
- 

## Next Steps

- [ ] Run 3 real tasks with API keys
- [ ] Document findings
- [ ] Proceed to Layer 2 (orchestrator)
