import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  buildFailureMessage,
  decideAfterCheck,
  failureKey,
  formatCheckResult,
  formatState,
  normalizeOutput,
  tail,
} from '../loop.js'

test('tail keeps the end of output', () => {
  assert.equal(tail('abcdef', 3), 'def')
  assert.equal(tail('abc', 10), 'abc')
  assert.equal(tail('', 3), '')
  assert.equal(tail('abc', 0), '')
})

test('normalizeOutput strips ANSI and collapses spaces', () => {
  assert.equal(normalizeOutput('\u001B[31mFAIL\u001B[0m\r\n  a   b  '), 'FAIL\na b')
})

test('failureKey distinguishes exit, timeout, and error', () => {
  const base = { exitCode: 1, timedOut: false, output: 'same' }
  assert.notEqual(failureKey(base), failureKey({ ...base, timedOut: true }))
  assert.notEqual(failureKey(base), failureKey({ exitCode: 2, timedOut: false, output: 'same' }))
  assert.notEqual(failureKey(base), failureKey({ exitCode: 1, error: 'spawn failed' }))
})

test('a passing check disarms green', () => {
  const decision = decideAfterCheck({ attempts: 0 }, { ok: true, exitCode: 0 }, { maxAttempts: 3, stopOnRepeat: true })
  assert.deepEqual(decision, { status: 'green', armed: false, steer: false, attempts: 1 })
})

test('a first failure arms a steering retry', () => {
  const decision = decideAfterCheck(
    { attempts: 0, lastFailureKey: null },
    { ok: false, exitCode: 1, output: 'boom' },
    { maxAttempts: 3, stopOnRepeat: true },
  )
  assert.equal(decision.status, 'red')
  assert.equal(decision.armed, true)
  assert.equal(decision.steer, true)
  assert.equal(decision.attempts, 1)
  assert.ok(decision.lastFailureKey)
})

test('a repeated failure stops as stalled', () => {
  const key = failureKey({ exitCode: 1, output: 'same' })
  const decision = decideAfterCheck(
    { attempts: 1, lastFailureKey: key },
    { ok: false, exitCode: 1, output: 'same' },
    { maxAttempts: 5, stopOnRepeat: true },
  )
  assert.equal(decision.status, 'stalled')
  assert.equal(decision.armed, false)
  assert.equal(decision.steer, false)
})

test('repeated output can keep looping when stopOnRepeat is false', () => {
  const key = failureKey({ exitCode: 1, output: 'same' })
  const decision = decideAfterCheck(
    { attempts: 1, lastFailureKey: key },
    { ok: false, exitCode: 1, output: 'same' },
    { maxAttempts: 3, stopOnRepeat: false },
  )
  assert.equal(decision.status, 'red')
  assert.equal(decision.armed, true)
  assert.equal(decision.steer, true)
})

test('the attempt budget stops the loop', () => {
  const decision = decideAfterCheck(
    { attempts: 2, lastFailureKey: 'other' },
    { ok: false, exitCode: 1, output: 'different' },
    { maxAttempts: 3, stopOnRepeat: true },
  )
  assert.equal(decision.status, 'red')
  assert.equal(decision.armed, false)
  assert.equal(decision.steer, false)
  assert.equal(decision.attempts, 3)
})

test('abort and infrastructure errors disarm without steering', () => {
  const aborted = decideAfterCheck({ attempts: 0 }, { ok: false, aborted: true }, { maxAttempts: 3, stopOnRepeat: true })
  assert.equal(aborted.status, 'aborted')
  assert.equal(aborted.armed, false)
  assert.equal(aborted.steer, false)
  const failed = decideAfterCheck({ attempts: 0 }, { ok: false, error: 'spawn failed' }, { maxAttempts: 3, stopOnRepeat: true })
  assert.equal(failed.status, 'error')
  assert.equal(failed.armed, false)
  assert.equal(failed.steer, false)
})

test('the failure message carries the command, attempt, and output', () => {
  const text = buildFailureMessage({
    attempt: 2,
    maxAttempts: 3,
    command: 'pnpm test',
    result: { exitCode: 1, timedOut: false, durationMs: 2400, output: '1 failing test' },
  })
  assert.match(text, /attempt 2\/3/)
  assert.match(text, /pnpm test/)
  assert.match(text, /1 failing test/)
  assert.match(text, /Do not claim/)
})

test('state and result formatters are readable', () => {
  const state = formatState({
    armed: true,
    running: false,
    status: 'red',
    attempts: 2,
    maxAttempts: 3,
    command: 'make test',
    error: null,
  })
  assert.match(state, /armed/)
  assert.match(state, /2\/3/)
  assert.match(state, /make test/)
  const pass = formatCheckResult({ ok: true, exitCode: 0, command: 'make test', output: 'ok' })
  assert.match(pass, /PASS/)
  const fail = formatCheckResult({ ok: false, exitCode: 1, command: 'make test', output: 'bad' })
  assert.match(fail, /FAIL/)
})
