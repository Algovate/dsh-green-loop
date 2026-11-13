/**
 * Pure loop decisions and formatting for the Green Loop plugin.
 *
 * Keeping the state machine free of Cordis, Node, and DSH imports lets the
 * exact retry/stall/stop rules be unit-tested without an agent or a shell.
 * @module dsh-green-loop/loop
 */

/** Statuses surfaced by the engine and the dock. */
export const STATUS = Object.freeze({
  off: 'off',
  armed: 'armed',
  running: 'running',
  green: 'green',
  red: 'red',
  stalled: 'stalled',
  error: 'error',
  aborted: 'aborted',
})

/** ANSI escape sequences that frequently wrap test output. */
const ANSI = /\u001B\[[0-?]*[ -/]*[@-~]/g

/**
 * Keep the last `max` characters of one output string.
 * @param {unknown} value - raw output.
 * @param {number} max - positive character bound.
 * @returns {string} the tail, without a dangling partial ANSI sequence.
 */
export function tail(value, max) {
  const text = typeof value === 'string' ? value : String(value ?? '')
  const bound = Math.max(0, Math.trunc(max) || 0)
  if (bound === 0) return ''
  return text.length <= bound ? text : text.slice(-bound)
}

/**
 * Normalize output for repeat detection while preserving the failure text.
 * @param {unknown} value - raw output.
 * @returns {string} ANSI-free, CR-free, whitespace-collapsed text.
 */
export function normalizeOutput(value) {
  return String(value ?? '')
    .replace(ANSI, '')
    .replace(/\r/g, '')
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .trim()
}

/**
 * Build the identity of one failure. Two identical failures mean another
 * identical retry would not make progress.
 * @param {{ exitCode: number | null, timedOut?: boolean, output?: string, error?: string }} result - check result.
 * @returns {string} stable failure key.
 */
export function failureKey(result) {
  const kind = result.timedOut ? 'timeout' : result.error ? 'error' : `exit:${String(result.exitCode)}`
  return `${kind}\n${normalizeOutput(result.error ?? result.output).slice(-2000)}`
}

/**
 * Decide what one finished check means for the armed loop.
 * @param {{ attempts: number, lastFailureKey?: string | null }} state - current loop state.
 * @param {{ ok: boolean, aborted?: boolean, error?: string, exitCode?: number | null, timedOut?: boolean, output?: string }} result - finished check.
 * @param {{ maxAttempts: number, stopOnRepeat: boolean }} config - loop limits.
 * @returns {{ status: string, armed: boolean, steer: boolean, attempts: number, lastFailureKey?: string | null }} next state.
 */
export function decideAfterCheck(state, result, config) {
  const attempts = Math.max(0, Math.trunc(state?.attempts) || 0) + 1
  if (result.aborted) return { status: STATUS.aborted, armed: false, steer: false, attempts }
  if (result.error) return { status: STATUS.error, armed: false, steer: false, attempts }
  if (result.ok) return { status: STATUS.green, armed: false, steer: false, attempts }

  const key = failureKey(result)
  if (config.stopOnRepeat && state.lastFailureKey && state.lastFailureKey === key) {
    return { status: STATUS.stalled, armed: false, steer: false, attempts, lastFailureKey: key }
  }

  const max = Math.max(1, Math.trunc(config.maxAttempts) || 1)
  if (attempts >= max) {
    return { status: STATUS.red, armed: false, steer: false, attempts, lastFailureKey: key }
  }
  return { status: STATUS.red, armed: true, steer: true, attempts, lastFailureKey: key }
}

/**
 * Build the steering message injected into the agent after a failed check.
 * @param {{ attempt: number, maxAttempts: number, command: string, result: { exitCode?: number | null, timedOut?: boolean, durationMs?: number, output?: string, error?: string } }} input - failure facts.
 * @returns {string} model-facing failure report.
 */
export function buildFailureMessage(input) {
  const { attempt, maxAttempts, command, result } = input
  const exit = result.timedOut ? 'timed out' : result.error ? `error: ${result.error}` : `exit ${String(result.exitCode)}`
  const duration = typeof result.durationMs === 'number' ? ` in ${formatDuration(result.durationMs)}` : ''
  const output = (result.output ?? '').trim() || '(no output)'
  return [
    `[Green Loop] The project check failed (attempt ${attempt}/${maxAttempts})${duration}: ${exit}.`,
    '',
    `Command: ${command}`,
    'Output (tail):',
    '```',
    output,
    '```',
    '',
    'Do not claim the task is complete yet. Fix the cause, then finish the turn again; Green Loop will rerun the check.',
  ].join('\n')
}

/**
 * Format a duration for humans.
 * @param {number} ms - milliseconds.
 * @returns {string} seconds with one decimal, or milliseconds below one second.
 */
export function formatDuration(ms) {
  const value = Math.max(0, Number(ms) || 0)
  if (value < 1000) return `${Math.trunc(value)}ms`
  return `${(value / 1000).toFixed(1)}s`
}

/**
 * One-line state summary for `/green status` and the `green_status` tool.
 * @param {{ armed: boolean, running: boolean, status: string, attempts: number, maxAttempts: number, command?: string, commandSource?: string | null, cwd?: string | null, last?: { ok?: boolean, exitCode?: number | null } | null, error?: string | null }} state - public state.
 * @returns {string} summary.
 */
export function formatState(state) {
  const parts = []
  parts.push(state.running ? 'running' : state.armed ? 'armed' : state.status)
  if (state.attempts > 0) parts.push(`attempt ${state.attempts}/${state.maxAttempts}`)
  if (state.command) parts.push(`check: ${state.command}`)
  else parts.push('no check resolved yet')
  if (state.error) parts.push(`error: ${state.error}`)
  return `Green Loop: ${parts.join(' · ')}`
}

/**
 * Format one check result for a tool or command.
 * @param {{ ok: boolean, aborted?: boolean, timedOut?: boolean, exitCode?: number | null, durationMs?: number, command?: string, output?: string, error?: string }} result - check result.
 * @returns {string} readable result.
 */
export function formatCheckResult(result) {
  const verdict = result.aborted ? 'ABORTED' : result.ok ? 'PASS' : 'FAIL'
  const reason = result.timedOut
    ? 'timed out'
    : result.error
      ? `error: ${result.error}`
      : `exit ${String(result.exitCode)}`
  const duration = typeof result.durationMs === 'number' ? ` · ${formatDuration(result.durationMs)}` : ''
  const output = (result.output ?? '').trim() || '(no output)'
  return [
    `Green Loop check: ${verdict} (${reason}${duration})`,
    result.command ? `Command: ${result.command}` : '',
    '',
    output,
  ].filter((line, index) => line.length > 0 || index === 2).join('\n')
}
