# Green Loop

![Green Loop dock while armed](dock.webp)

**Arm once. The agent keeps fixing until your project check passes.**

Coding agents are optimistic. They write the code, run a quick command, and announce success — then CI
fails on a test they never ran. Green Loop closes that gap: after each turn it runs the project's check,
and if the check fails it sends the failure back to the agent **before the turn is allowed to close**.
The agent sees the failing test, fixes it, and the check runs again. Green means done.

## A 20-second demo

1. Open a coding session. The dock shows **Green Loop** above the composer.
2. Click **Arm**. The plugin auto-detects `pnpm test` / `npm test` / `pytest` / `go test` /
   `cargo test` / `make test` from the project root (or uses `config.command`).
3. Let the agent finish a turn.
4. If the check fails, the failure output is steered into the same turn. The agent keeps working.
5. When the check passes, the loop disarms and the dock turns green.

No second model is asked whether the work is good. The exit code is the decision.

## What it is not

- **Not a manual quality gate.** Tools such as `dsh-doublecheck` produce a delivery verdict on
  demand; Green Loop is the automatic “run it and make the agent fix it” loop.
- **Not an LLM reviewer.** It does not ask a model to review code. It runs the command you trust.
- **Not auto-continue.** It does not blindly send “continue” after a network error; it feeds a
  concrete, bounded failure report back.
- **Not a code generator.** It only executes the project check and decides when to stop.

## Controls

| Surface | What you can do |
|---|---|
| Dock | Arm, Disarm, Run now, Stop, Details (command, cwd, attempts, last output) |
| `/green` | `start`, `stop`, `run`, `status` |
| `green_check` tool | The agent can probe the check before claiming completion |
| `green_status` tool | Read armed/running/attempts/last result |

The agent **cannot arm or disarm** the loop. Automatic command execution stays a user decision.

## Bounded by design

- `maxAttempts` (default 3) checks per armed cycle.
- `timeoutMs` (default 180s) kills a check that does not exit.
- Two identical failures in a row stop the loop as `stalled` instead of burning attempts.
- Only `outputTailChars` (default 4000) of output is kept for steering and the dock.
- Stop from the dock or `/green stop` aborts a running check.

## Safety

Green Loop runs a shell command. It is opt-in, but once armed it runs after every turn.

- The command comes from `config.command` or read-only detection; the model cannot change it.
- Checks run through `ctx.shell`, the same executor and sandbox as the `bash` tool.
- Detection reads project metadata and never executes anything.
- The plugin does not read credentials, make network requests, or write project files.
- Treat the configured command like a `package.json` script: only use it in projects you trust.

## Compatibility

- DSH `>=0.2.2-0 <0.3.0`, Node `>=22.19`.
- Web client required for the dock; tools and the turn-stopping loop also work without the dock.
- Verified on DSH 0.2.2-rc.3 Desktop: arm → turn-stopping → `make test` → green.

## Configuration

```yaml
- id: green-loop
  name: dsh-green-loop
  config:
    command: ''             # explicit check; empty = detect from the project root
    timeoutMs: 180000
    maxAttempts: 3
    stopOnRepeat: true
    outputTailChars: 4000
    cwd: ''
    detect: true
```

See the [README](../README.md) for the full command-resolution table and architecture notes.
