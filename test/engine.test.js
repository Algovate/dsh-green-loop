import assert from 'node:assert/strict'
import { test } from 'node:test'
import { GreenLoopEngine, GreenLoopError } from '../engine.js'

/**
 * Build an engine with a scripted shell.
 * @param {Array<Record<string, unknown>>} results - queue of shell results or errors.
 * @param {Partial<Record<string, unknown>>} [overrides] - config or detector overrides.
 * @returns {{ engine: GreenLoopEngine, agent: any, steers: any[], specs: any[] }} fixtures.
 */
function fixture(results, overrides = {}) {
  const queue = [...results]
  const specs = []
  const steers = []
  const shell = {
    resolve(spec) {
      specs.push(spec)
      return spec
    },
    async execute() {
      const next = queue.shift()
      if (next instanceof Error) throw next
      return { result: async () => next }
    },
  }
  const config = {
    command: 'fake-check',
    timeoutMs: 1000,
    maxAttempts: 3,
    stopOnRepeat: true,
    outputTailChars: 500,
    cwd: '',
    detect: true,
    ...overrides.config,
  }
  const engine = new GreenLoopEngine({
    shell,
    config,
    createMessage: (text) => ({ text }),
    detector: overrides.detector ?? (async () => null),
    logger: { warn: () => {} },
    now: () => 1000,
  })
  const agent = {
    session: { header: { id: 'session-1', cwd: '/repo' } },
    steer(message) { steers.push(message) },
  }
  return { engine, agent, steers, specs }
}

/** @returns {Record<string, unknown>} a failing shell result. */
function fail(output = 'boom') {
  return { exitCode: 1, timedOut: false, aborted: false, stdout: { text: output }, stderr: { text: '' } }
}

/** @returns {Record<string, unknown>} a passing shell result. */
function pass(output = 'ok') {
  return { exitCode: 0, timedOut: false, aborted: false, stdout: { text: output }, stderr: { text: '' } }
}

test('arm resolves the configured command and reports it', async () => {
  const { engine, agent } = fixture([])
  const state = await engine.arm(agent)
  assert.equal(state.armed, true)
  assert.equal(state.status, 'armed')
  assert.equal(state.command, 'fake-check')
  assert.equal(state.commandSource, 'config')
  assert.equal(state.cwd, '/repo')
  assert.equal(state.maxAttempts, 3)
})

test('a failed turn-ending check steers the agent once', async () => {
  const { engine, agent, steers } = fixture([fail('1 failing test')])
  await engine.arm(agent)
  const state = await engine.handleTurnStopping(agent, undefined)
  assert.equal(state.armed, true)
  assert.equal(state.status, 'red')
  assert.equal(state.attempts, 1)
  assert.equal(steers.length, 1)
  assert.match(steers[0].text, /1 failing test/)
  assert.match(steers[0].text, /attempt 1\/3/)
})

test('a passing turn-ending check disarms green', async () => {
  const { engine, agent, steers } = fixture([pass()])
  await engine.arm(agent)
  const state = await engine.handleTurnStopping(agent, undefined)
  assert.equal(state.armed, false)
  assert.equal(state.status, 'green')
  assert.equal(state.attempts, 1)
  assert.equal(steers.length, 0)
})

test('repeated identical failures stop as stalled', async () => {
  const { engine, agent, steers } = fixture([fail('same'), fail('same')])
  await engine.arm(agent)
  await engine.handleTurnStopping(agent, undefined)
  const state = await engine.handleTurnStopping(agent, undefined)
  assert.equal(state.armed, false)
  assert.equal(state.status, 'stalled')
  assert.equal(state.attempts, 2)
  assert.equal(steers.length, 1)
})

test('the attempt budget stops after the configured number of checks', async () => {
  const { engine, agent, steers } = fixture([fail('one'), fail('two'), fail('three')], { config: { maxAttempts: 3 } })
  await engine.arm(agent)
  await engine.handleTurnStopping(agent, undefined)
  await engine.handleTurnStopping(agent, undefined)
  const state = await engine.handleTurnStopping(agent, undefined)
  assert.equal(state.armed, false)
  assert.equal(state.status, 'red')
  assert.equal(state.attempts, 3)
  assert.equal(steers.length, 2)
})

test('an aborted check disarms without steering', async () => {
  const aborted = { exitCode: null, timedOut: false, aborted: true, stdout: { text: '' }, stderr: { text: '' } }
  const { engine, agent, steers } = fixture([aborted])
  await engine.arm(agent)
  const state = await engine.handleTurnStopping(agent, undefined)
  assert.equal(state.armed, false)
  assert.equal(state.status, 'aborted')
  assert.equal(steers.length, 0)
})

test('a shell infrastructure failure reports error and disarms', async () => {
  const { engine, agent, steers } = fixture([new Error('spawn failed')])
  await engine.arm(agent)
  const state = await engine.handleTurnStopping(agent, undefined)
  assert.equal(state.armed, false)
  assert.equal(state.status, 'error')
  assert.match(state.error, /spawn failed/)
  assert.equal(steers.length, 0)
})

test('runNow arms and steers immediately on failure', async () => {
  const { engine, agent, steers } = fixture([fail('bad')])
  const state = await engine.runNow(agent)
  assert.equal(state.armed, true)
  assert.equal(state.status, 'red')
  assert.equal(state.attempts, 1)
  assert.equal(steers.length, 1)
})

test('runNow passes and disarms', async () => {
  const { engine, agent } = fixture([pass()])
  const state = await engine.runNow(agent)
  assert.equal(state.armed, false)
  assert.equal(state.status, 'green')
})

test('check probes without arming or steering', async () => {
  const { engine, agent, steers } = fixture([fail('probe')])
  const result = await engine.check(agent)
  assert.equal(result.ok, false)
  assert.match(result.output, /probe/)
  const state = engine.status('session-1')
  assert.equal(state.armed, false)
  assert.equal(state.status, 'off')
  assert.equal(steers.length, 0)
})

test('detection supplies the command when config.command is empty', async () => {
  const { engine, agent } = fixture([], {
    config: { command: '' },
    detector: async () => ({ command: 'make test', source: 'Makefile:test' }),
  })
  const state = await engine.arm(agent)
  assert.equal(state.command, 'make test')
  assert.equal(state.commandSource, 'Makefile:test')
})

test('a missing command produces a no-check error', async () => {
  const { engine, agent } = fixture([], {
    config: { command: '', detect: false },
  })
  await assert.rejects(engine.arm(agent), (error) => error instanceof GreenLoopError && error.code === 'no-check')
})

test('a relative config.cwd resolves from the session cwd', async () => {
  const { engine, agent } = fixture([], { config: { cwd: 'packages/app' } })
  const state = await engine.arm(agent)
  assert.equal(state.cwd, '/repo/packages/app')
})

test('disarm aborts a running check', async () => {
  let release
  const gate = new Promise((resolve) => { release = resolve })
  const steers = []
  const shell = {
    resolve: (spec) => spec,
    execute: async () => ({
      result: async () => {
        await gate
        return { exitCode: 1, timedOut: false, aborted: false, stdout: { text: 'late' }, stderr: { text: '' } }
      },
    }),
  }
  const engine = new GreenLoopEngine({
    shell,
    config: { command: 'fake', timeoutMs: 1000, maxAttempts: 3, stopOnRepeat: true, outputTailChars: 100, cwd: '', detect: false },
    createMessage: (text) => ({ text }),
    logger: { warn: () => {} },
  })
  const agent = { session: { header: { id: 's', cwd: '/repo' } }, steer: (message) => steers.push(message) }
  await engine.arm(agent)
  const running = engine.handleTurnStopping(agent, undefined)
  await new Promise((resolve) => setTimeout(resolve, 10))
  engine.disarm('s')
  release()
  const state = await running
  assert.equal(state.armed, false)
  assert.equal(state.status, 'aborted')
  assert.equal(steers.length, 0)
})
