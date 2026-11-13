# Changelog

## 0.1.0 — 2026-11-13

First release.

- Per-session Green Loop state with `arm`, `disarm`, `run now`, `status`, and `stop`.
- `agent/turn-stopping` hook runs the project check before a turn closes and steers the same
  turn with the bounded failure output when it fails.
- Bounded retries (`maxAttempts`), per-check timeout, repeated-output stall detection, and
  abortable runs.
- Four model tools/commands: `green_check`, `green_status`, `/green start|stop|run|status`.
- Composer dock with status, Arm/Disarm/Run/Stop, and a details panel.
- Authenticated browser API under `/green-loop/api` through DSH Connection admission.
- Read-only check detection for Node (pnpm/npm/yarn/bun), Python (pytest/uv/poetry), Go, Rust,
  and Make.
- Schemastery `Config` for command, timeout, attempts, output tail, cwd, and detection.
- 42 unit/engine/client-manifest tests, package-manifest release tests, and a jsdom dock
  interaction test.

Live verified on DSH 0.2.2-rc.3 Desktop: arm → turn-stopping → `make test` → green.
