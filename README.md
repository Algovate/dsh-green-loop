# dsh-green-loop

[![CI](https://github.com/algovate/dsh-green-loop/actions/workflows/ci.yml/badge.svg)](https://github.com/algovate/dsh-green-loop/actions/workflows/ci.yml)
[![GitHub](https://img.shields.io/badge/GitHub-algovate%2Fdsh--green--loop-181717?logo=github)](https://github.com/algovate/dsh-green-loop)
[![npm](https://img.shields.io/npm/v/dsh-green-loop)](https://www.npmjs.com/package/dsh-green-loop)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)


**Arm once. The agent keeps fixing until your project check passes.**

![Green Loop demo: arm, failing check, steer, green](docs/demo.gif)

<sub>The GIF is a simulated demo of the UI flow. The plugin itself is installed and verified; the real dock screenshot is [here](docs/dock.webp).</sub>

![Green Loop dock while armed](docs/dock.webp)

`dsh-green-loop` is a DeepSeek Harness plugin for coding agents that do not stop at the
right moment. After every turn, it runs your test/lint/typecheck command. If the command fails,
the plugin **steers the same turn** with the failure output, so the agent sees the failing test
and keeps working. The loop stops when the check is green, the attempt budget runs out, the
output stops changing, or you stop it.

This is deterministic verification, not another model reviewing the model:

| | Green Loop | Manual quality gate | Auto-continue on network errors |
|---|---|---|---|
| Trigger | turn ends while armed | user runs `/gate` | network failure |
| Decision | exit code of your command | evidence/spec rules | transport error |
| Action | steer the agent with the output | report / rework verdict | send "continue" |
| Stop rule | green / attempts / stalled output | gate verdict | transport recovery |

## Install

```sh
dsh plugin --profile <profile> add dsh-green-loop@0.1.0
```

Or install a local checkout / release tarball from **Settings → Plugins**:

```sh
dsh plugin --profile <profile> add ./dsh-green-loop-0.1.0.tgz
```

The package declares `dsh.bundle.patch`, so the profile adds it to `dsh.profile.bundles` and the
patch inserts the Host row. The composer dock attaches through `dsh.client`.

Requires DSH `0.2.2-rc.0` or newer in the `0.2.x` line.

## Quick start

1. Install and open a coding session.
2. The composer dock shows **Green Loop**:
   - **Arm** detects a check command and arms the loop.
   - **Run now** runs the check immediately, even without arming.
   - **Details** shows the command, working directory, attempt count, and last output.
3. Let the agent finish a turn. The check runs:
   - **PASS** → the loop disarms and the dock turns green.
   - **FAIL** → the failure output is sent back to the agent as steering; the same turn
     continues, and the check runs again when the agent next stops.
   - **No progress** → two identical failures stop the loop as `stalled`.
   - **Attempt budget** → after `maxAttempts` checks the loop disarms red.
4. Stop at any time from the dock, or run `/green stop`.

The command plane also works without the dock:

```text
/green status    show armed/running/attempts and the resolved command
/green start     arm; the check runs when the next turn stops
/green run       run the check now; failures are steered immediately
/green stop      disarm and abort a running check
```

## Check command resolution

If `config.command` is set, it wins. Otherwise the plugin detects one from the session's
working directory **without executing anything**:

| Project signal | Command |
|---|---|
| `package.json` `scripts.test` + `pnpm-lock.yaml` | `pnpm test` |
| `package.json` `scripts.test` + `yarn.lock` | `yarn test` |
| `package.json` `scripts.test` + Bun lockfile | `bun run test` |
| `package.json` `scripts.test` | `npm test` |
| `pyproject.toml` / `pytest.ini` / `tox.ini` / `tests/` | `pytest -q` (`uv run` / `poetry run` with lockfiles) |
| `go.mod` | `go test ./...` |
| `Cargo.toml` | `cargo test` |
| `Makefile` with a `test:` target | `make test` |

The detected command is shown in the dock before it runs. A monorepo or a nonstandard layout
should set `command` explicitly.

## Configuration

```yaml
- id: green-loop
  name: dsh-green-loop
  config:
    command: ''             # explicit check; empty = detect from the project root
    timeoutMs: 180000       # one check, including preparation
    maxAttempts: 3          # checks in one armed cycle
    stopOnRepeat: true      # identical failure twice = no progress -> stop
    outputTailChars: 4000   # output kept for steering and the dock
    cwd: ''                 # override; relative resolves from the session cwd
    detect: true            # allow auto-detection when command is empty
```

Every field is a Schemastery-validated row config, so users can override it in their profile's
`cordis.patch.yml` without editing the package. The generic **Settings → Plugins** form shows
the same schema.

## Model tools

| Tool | Purpose |
|---|---|
| `green_check` | Run the configured/detected check and return pass/fail plus the output tail. Use it before claiming a coding task is complete. |
| `green_status` | Report armed/running/attempts, the resolved command, and the last result. |

The agent cannot arm or disarm the loop; that stays a user decision. `green_check` is a
read-only probe: it never arms the loop or steers the agent.

## How it works

1. **Arm** resolves the command and creates a per-session loop state.
2. On `agent/turn-stopping`, the Host runs the command through `ctx.shell`, the same executor
   and sandbox as the `bash` tool.
3. A non-zero exit, timeout, or infrastructure error becomes a failure. The plugin builds a
   bounded failure report and calls `agent.steer(...)`; the loop re-reads its inbox and runs
   another step instead of closing the turn.
4. A green check disarms the loop. A repeated failure output stops it as `stalled`; the attempt
   budget stops it as `red`.
5. The dock polls the Host API only while armed/running; nothing is persisted after a restart.

See [docs/architecture.md](docs/architecture.md) for the sequence, state machine, and failure
modes.

## Security and cost

- **Opt-in.** Nothing runs until the user arms the loop or explicitly calls `green_check` /
  `/green run`. The agent has no arm tool.
- **User-configured command.** The model cannot change the command. Auto-detection only reads
  project metadata; it never executes while detecting.
- **Same execution boundary as the agent.** Checks go through `ctx.shell`, so the deployment's
  sandbox, working directory, and environment apply. A timeout kills the check.
- **Bounded output.** Only `outputTailChars` is kept for steering and the dock; the rest is not
  persisted by this plugin.
- **Cost.** A failing loop consumes another model step per attempt. The attempt budget and
  stalled-output rule bound that cost; disarm at any time.
- **Trust the command.** Arming runs the configured/detected command automatically after each
  turn. Treat it like a `package.json` script: only use it in projects whose commands you trust.

## Verification

```sh
node --test test/*.test.js
node --check index.js && node --check client.js && node --check engine.js \
  && node --check detect.js && node --check loop.js
```

The suite covers detection, the pure retry/stall/stop decisions, the live engine with a fake
agent/shell, abort behavior, the browser factory, and the release manifest.

Live verification on DSH 0.2.2-rc.3 Desktop:

- `green_check` passed `make test` (61 workspace tests);
- the dock was armed by the user (`docs/dock.webp`);
- the turn-stopping hook ran `make test` and reported `green · attempt 1/3`, disarming itself.

The failure → steer → fix path is covered by engine tests with a fake agent; it has not been
exercised against a deliberately failing real project yet. The full record is in
[docs/verification.md](docs/verification.md).

## Releasing

See [docs/RELEASE.md](docs/RELEASE.md) for the npm, tarball, and marketplace checklist.

## Limitations

- The loop runs when an **armed session's turn stops**, including a turn where the agent ends
  with a normal prose question. Disarm if you do not want that.
- A check must terminate. Watch-mode commands hit `timeoutMs`.
- Detection is root-only and heuristic; monorepos should set `command`.
- State is process-local and re-armed explicitly after a restart.
- The dock is one `conversation.input.dock` entry; it does not portal fixed overlays.
