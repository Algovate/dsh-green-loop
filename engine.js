/**
 * Green Loop engine: per-session arm state, bounded check execution, and the
 * turn-stopping decision that keeps an agent working until checks pass.
 *
 * The engine is deliberately free of Cordis/DSH imports. `index.js` injects
 * the shell service, the user-message factory, and the detector, which keeps
 * the retry/stall/stop behavior testable with a fake agent and fake shell.
 * @module dsh-green-loop/engine
 */

import { isAbsolute, join } from 'node:path'
import { detectCheckCommand } from './detect.js'
import { buildFailureMessage, decideAfterCheck, tail, STATUS } from './loop.js'

/** A stable, user-facing engine failure. */
export class GreenLoopError extends Error {
  /**
   * @param {string} code - stable machine code.
   * @param {string} message - user-facing explanation.
   */
  constructor(code, message) {
    super(message)
    this.name = 'GreenLoopError'
    this.code = code
  }
}

/**
 * Per-session loop engine.
 */
export class GreenLoopEngine {
  /** @type {Map<string, any>} */
  #states = new Map()
  /** @type {Set<string>} */
  #active = new Set()
  /** @type {{ command: string, timeoutMs: number, maxAttempts: number, stopOnRepeat: boolean, outputTailChars: number, cwd: string, detect: boolean }} */
  #config
  /** @type {{ resolve: Function, execute: Function }} */
  #shell
  /** @type {(text: string) => any} */
  #createMessage
  /** @type {(cwd: string) => Promise<{ command: string, source: string } | null>} */
  #detector
  /** @type {{ warn: (message: string) => void }} */
  #logger
  /** @type {() => number} */
  #now

  /**
   * @param {{
   *   shell: { resolve: Function, execute: Function },
   *   config: { command: string, timeoutMs: number, maxAttempts: number, stopOnRepeat: boolean, outputTailChars: number, cwd: string, detect: boolean },
   *   createMessage: (text: string) => any,
   *   detector?: (cwd: string) => Promise<{ command: string, source: string } | null>,
   *   logger?: { warn: (message: string) => void },
   *   now?: () => number,
   * }} options - engine dependencies.
   */
  constructor(options) {
    if (!options?.shell || typeof options.shell.resolve !== 'function' || typeof options.shell.execute !== 'function') {
      throw new TypeError('GreenLoopEngine requires the ctx.shell service')
    }
    this.#shell = options.shell
    this.#config = options.config
    this.#createMessage = options.createMessage ?? ((text) => ({ content: [{ type: 'text', text }], source: { kind: 'green-loop' } }))
    this.#detector = options.detector ?? detectCheckCommand
    this.#logger = options.logger ?? { warn: (message) => console.warn(message) }
    this.#now = options.now ?? Date.now
  }

  /** Resolved configuration (read-only by convention). */
  get config() {
    return this.#config
  }

  /**
   * Arm one session. Detection happens here, so the resolved command is shown
   * before anything runs.
   * @param {{ session: { header: { id: string, cwd?: string } }, steer: Function }} agent - live agent.
   * @returns {Promise<any>} public state.
   */
  async arm(agent) {
    const sessionId = sessionIdOf(agent)
    const existing = this.#states.get(sessionId)
    if (existing?.running === true) throw new GreenLoopError('busy', 'a Green Loop check is already running')
    const cwd = this.#resolveCwd(agent)
    const resolved = await this.#resolveCommand(cwd)
    if (resolved === null) {
      throw new GreenLoopError(
        'no-check',
        `no check command was configured or detected in ${cwd}. Set config.command (for example "pnpm test") or add a test script/Makefile.`,
      )
    }
    const state = this.#defaultState(sessionId)
    state.armed = true
    state.status = STATUS.armed
    state.command = resolved.command
    state.commandSource = resolved.source
    state.cwd = cwd
    state.updatedAt = this.#now()
    this.#states.set(sessionId, state)
    return this.#publicState(state)
  }

  /**
   * Disarm one session and abort its running check.
   * @param {string} sessionId - session identity.
   * @param {string} [reason] - why it stopped, for the dock.
   * @returns {any} public state.
   */
  disarm(sessionId, reason = 'stopped by user') {
    const state = this.#states.get(sessionId)
    if (state === undefined) return this.#publicState(this.#defaultState(sessionId))
    state.armed = false
    state.updatedAt = this.#now()
    if (state.running && state.abort !== null) {
      state.error = reason
      state.abort.abort()
    } else if (state.status === STATUS.armed) {
      state.status = STATUS.off
    }
    return this.#publicState(state)
  }

  /**
   * Public state for one session (a default state when never armed).
   * @param {string} sessionId - session identity.
   * @returns {any} detached public state.
   */
  status(sessionId) {
    return this.#publicState(this.#states.get(sessionId) ?? this.#defaultState(sessionId))
  }

  /**
   * Prepare a user-triggered run: arm/detect when needed, reject a busy loop.
   * @param {{ session: { header: { id: string, cwd?: string } }, steer: Function }} agent - live agent.
   * @returns {Promise<any>} public state with a resolved command.
   */
  async prepareRun(agent) {
    const sessionId = sessionIdOf(agent)
    const state = this.#states.get(sessionId)
    if (state?.running === true) throw new GreenLoopError('busy', 'a Green Loop check is already running')
    if (state === undefined || !state.armed || state.command.length === 0) {
      return await this.arm(agent)
    }
    return this.#publicState(state)
  }

  /**
   * Run one check now. On failure the agent is steered immediately; the armed
   * loop then checks again when the resulting turn stops.
   * @param {{ session: { header: { id: string, cwd?: string } }, steer: Function }} agent - live agent.
   * @returns {Promise<any>} public state.
   */
  async runNow(agent) {
    await this.prepareRun(agent)
    const sessionId = sessionIdOf(agent)
    const state = this.#states.get(sessionId)
    const result = await this.#runCheck(agent, state, null)
    const decision = decideAfterCheck(state, result, this.#config)
    this.#apply(state, result, decision)
    if (decision.steer && state.armed) this.#steer(agent, state)
    return this.#publicState(state)
  }

  /**
   * Probe the configured check without arming or steering. Used by the
   * `green_check` tool.
   * @param {{ session: { header: { id: string, cwd?: string } }, steer: Function }} agent - live agent.
   * @returns {Promise<any>} check result.
   */
  async check(agent) {
    const sessionId = sessionIdOf(agent)
    const state = this.#states.get(sessionId)
    if (state?.running === true || this.#active.has(sessionId)) {
      throw new GreenLoopError('busy', 'a Green Loop check is already running')
    }
    const cwd = state?.cwd ?? this.#resolveCwd(agent)
    const resolved = state?.command
      ? { command: state.command, source: state.commandSource }
      : await this.#resolveCommand(cwd)
    if (resolved === null) {
      throw new GreenLoopError(
        'no-check',
        `no check command was configured or detected in ${cwd}. Set config.command or add a test script/Makefile.`,
      )
    }
    const probe = { command: resolved.command, cwd, attempts: 0, running: false, abort: null }
    return await this.#runCheck(agent, probe, null)
  }

  /**
   * Turn-stopping hook: run the check and steer the agent to fix a failure.
   * @param {{ session: { header: { id: string, cwd?: string } }, steer: Function }} agent - live agent.
   * @param {AbortSignal | undefined} signal - turn-stopping cancellation.
   * @returns {Promise<any | undefined>} public state when the loop acted.
   */
  async handleTurnStopping(agent, signal) {
    const sessionId = sessionIdOf(agent)
    const state = this.#states.get(sessionId)
    if (state === undefined || !state.armed || state.running) return undefined
    if (signal?.aborted) {
      state.armed = false
      state.status = STATUS.aborted
      state.updatedAt = this.#now()
      return this.#publicState(state)
    }
    if (state.attempts >= state.maxAttempts) {
      state.armed = false
      state.status = STATUS.red
      state.error = `attempt limit reached (${state.maxAttempts})`
      state.updatedAt = this.#now()
      return this.#publicState(state)
    }

    const result = await this.#runCheck(agent, state, signal)
    const decision = decideAfterCheck(state, result, this.#config)
    this.#apply(state, result, decision)
    if (decision.steer && state.armed) this.#steer(agent, state)
    return this.#publicState(state)
  }

  /**
   * Reset one session's loop state (test/admin helper; not exposed as a tool).
   * @param {string} sessionId - session identity.
   * @returns {void}
   */
  reset(sessionId) {
    this.#states.delete(sessionId)
  }

  /**
   * Build the default public state for a session.
   * @param {string} sessionId - session identity.
   * @returns {any} state.
   */
  #defaultState(sessionId) {
    return {
      sessionId,
      armed: false,
      running: false,
      status: STATUS.off,
      attempts: 0,
      maxAttempts: this.#config.maxAttempts,
      command: '',
      commandSource: null,
      cwd: null,
      configured: this.#config.command.trim().length > 0,
      detect: this.#config.detect,
      last: null,
      history: [],
      error: null,
      updatedAt: this.#now(),
    }
  }

  /**
   * Detach internal fields from one state.
   * @param {any} state - internal state.
   * @returns {any} public state.
   */
  #publicState(state) {
    const { abort, lastFailureKey, ...rest } = state
    return structuredClone(rest)
  }

  /**
   * Resolve the explicit or detected check command.
   * @param {string} cwd - project root.
   * @returns {Promise<{ command: string, source: string } | null>} resolved command.
   */
  async #resolveCommand(cwd) {
    const configured = this.#config.command.trim()
    if (configured.length > 0) return { command: configured, source: 'config' }
    if (!this.#config.detect) return null
    try {
      return await this.#detector(cwd)
    } catch (error) {
      this.#logger.warn(`[green-loop] check detection failed in ${cwd}: ${messageOf(error)}`)
      return null
    }
  }

  /**
   * Resolve the project root for one agent.
   * @param {{ session: { header: { cwd?: string } } }} agent - live agent.
   * @returns {string} absolute working directory.
   */
  #resolveCwd(agent) {
    const sessionCwd = typeof agent?.session?.header?.cwd === 'string' && agent.session.header.cwd.length > 0
      ? agent.session.header.cwd
      : process.cwd()
    const configured = this.#config.cwd.trim()
    if (configured.length === 0) return sessionCwd
    return isAbsolute(configured) ? configured : join(sessionCwd, configured)
  }

  /**
   * Run the check command under the shell seam and normalize the result.
   * @param {any} agent - live agent (used for the session key only).
   * @param {any} state - loop or probe state.
   * @param {AbortSignal | undefined} signal - external cancellation.
   * @returns {Promise<any>} normalized check result.
   */
  async #runCheck(agent, state, signal) {
    const sessionId = sessionIdOf(agent)
    if (this.#active.has(sessionId)) throw new GreenLoopError('busy', 'a Green Loop check is already running')
    this.#active.add(sessionId)
    state.running = true
    state.status = STATUS.running
    state.error = null
    state.updatedAt = this.#now()

    const controller = new AbortController()
    state.abort = controller
    const onAbort = () => controller.abort()
    if (signal != null) {
      if (signal.aborted) controller.abort()
      else signal.addEventListener('abort', onAbort, { once: true })
    }

    const started = this.#now()
    try {
      const execution = await this.#shell.execute(this.#shell.resolve({
        command: state.command,
        workdir: state.cwd,
        timeoutMs: this.#config.timeoutMs,
        onExpiry: 'kill',
        signal: controller.signal,
        stdoutMaxBytes: 256 * 1024,
      }))
      const result = await execution.result()
      const stdout = result.stdout?.text ?? ''
      const stderr = result.stderr?.text ?? ''
      const combined = [stdout, stderr.length > 0 ? `--- stderr ---\n${stderr}` : '']
        .filter((part) => part.length > 0)
        .join('\n')
      const timedOut = result.timedOut === true
      const aborted = result.aborted === true || controller.signal.aborted
      const ok = result.exitCode === 0 && !timedOut && !aborted
      const durationMs = Math.max(0, this.#now() - started)
      return {
        ok,
        exitCode: result.exitCode ?? null,
        timedOut,
        aborted,
        durationMs,
        command: state.command,
        output: tail(combined, this.#config.outputTailChars),
        at: this.#now(),
        attempt: Math.max(1, (state.attempts ?? 0) + 1),
      }
    } catch (error) {
      const aborted = controller.signal.aborted
      return {
        ok: false,
        exitCode: null,
        timedOut: false,
        aborted,
        durationMs: Math.max(0, this.#now() - started),
        command: state.command,
        output: aborted ? '' : messageOf(error),
        error: aborted ? undefined : messageOf(error),
        at: this.#now(),
        attempt: Math.max(1, (state.attempts ?? 0) + 1),
      }
    } finally {
      if (signal != null) signal.removeEventListener('abort', onAbort)
      state.abort = null
      state.running = false
      state.updatedAt = this.#now()
      this.#active.delete(sessionId)
    }
  }

  /**
   * Publish one check decision into the loop state.
   * @param {any} state - loop state.
   * @param {any} result - check result.
   * @param {{ status: string, armed: boolean, attempts: number, lastFailureKey?: string | null }} decision - pure decision.
   * @returns {void}
   */
  #apply(state, result, decision) {
    state.attempts = decision.attempts
    state.status = decision.status
    state.armed = decision.armed
    state.last = result
    if (decision.lastFailureKey !== undefined) state.lastFailureKey = decision.lastFailureKey
    state.error = result.error ?? null
    state.history.push({
      attempt: decision.attempts,
      status: result.aborted ? STATUS.aborted : result.ok ? STATUS.green : result.error ? STATUS.error : STATUS.red,
      exitCode: result.exitCode ?? null,
      durationMs: result.durationMs,
      at: result.at,
    })
    if (state.history.length > 10) state.history = state.history.slice(-10)
    state.updatedAt = this.#now()
  }

  /**
   * Steer the live agent with one failure report.
   * @param {any} agent - live agent.
   * @param {any} state - loop state.
   * @returns {void}
   */
  #steer(agent, state) {
    if (!state.armed || state.last === null) return
    const text = buildFailureMessage({
      attempt: state.attempts,
      maxAttempts: state.maxAttempts,
      command: state.command,
      result: state.last,
    })
    try {
      agent.steer(this.#createMessage(text))
    } catch (error) {
      state.armed = false
      state.status = STATUS.error
      state.error = `could not steer the agent: ${messageOf(error)}`
      state.updatedAt = this.#now()
    }
  }
}

/**
 * Read the session identity from an agent, or throw a clear error.
 * @param {{ session?: { header?: { id?: string } } }} agent - live agent.
 * @returns {string} session id.
 */
function sessionIdOf(agent) {
  const id = agent?.session?.header?.id
  if (typeof id !== 'string' || id.length === 0) {
    throw new GreenLoopError('no-session', 'Green Loop requires a live agent with a session')
  }
  return id
}

/**
 * Readable message for an unknown thrown value.
 * @param {unknown} error - thrown value.
 * @returns {string} message text.
 */
export function messageOf(error) {
  return error instanceof Error ? error.message : String(error)
}
