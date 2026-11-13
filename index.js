/**
 * Green Loop — Host half.
 *
 * One per-session engine powers four surfaces:
 * - the `agent/turn-stopping` hook, which reruns the project check after a turn
 *   and steers the agent to fix failures until the check passes or the attempt
 *   budget runs out;
 * - the `green_check` / `green_status` model tools;
 * - the `/green` slash command;
 * - an authenticated state/action API for the composer dock.
 *
 * The check command is explicit (`config.command`) or detected read-only from
 * the project root. Nothing runs until the user arms the loop or calls a tool.
 * @module dsh-green-loop
 */

import { Service } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import z from '@deepseek-ai/schemastery'
import { GreenLoopEngine, GreenLoopError, messageOf } from './engine.js'
import { formatCheckResult, formatState } from './loop.js'

/** Row configuration. Every tunable lives here so users can change it in `cordis.patch.yml`. */
export const Config = z.object({
  /** Explicit check command. Empty detects one from the project root. */
  command: z.string().default(''),
  /** Deadline for one check, including preparation. */
  timeoutMs: z.number().step(1000).min(5000).max(900000).default(180000),
  /** Maximum checks in one armed cycle. */
  maxAttempts: z.number().step(1).min(1).max(10).default(3),
  /** Stop when two consecutive failures produce identical output. */
  stopOnRepeat: z.boolean().default(true),
  /** Characters of check output kept for the model and the dock. */
  outputTailChars: z.number().step(100).min(500).max(20000).default(4000),
  /** Working directory override; relative paths resolve from the session cwd. */
  cwd: z.string().default(''),
  /** Detect a check command when `command` is empty. */
  detect: z.boolean().default(true),
})

/** HTTP prefix owned by this plugin. */
const API_PREFIX = '/green-loop/api'
/** Request body bound for the browser API. */
const API_BODY_LIMIT = 16 * 1024

/**
 * Fill defaults for direct callers that bypass the Loader schema.
 * @param {Partial<z.infer<typeof Config>> | undefined} config - row configuration.
 * @returns {{ command: string, timeoutMs: number, maxAttempts: number, stopOnRepeat: boolean, outputTailChars: number, cwd: string, detect: boolean }} resolved values.
 */
export function resolveConfig(config) {
  return {
    command: typeof config?.command === 'string' ? config.command.trim() : '',
    timeoutMs: clampInteger(config?.timeoutMs, 5000, 900000, 180000),
    maxAttempts: clampInteger(config?.maxAttempts, 1, 10, 3),
    stopOnRepeat: config?.stopOnRepeat !== false,
    outputTailChars: clampInteger(config?.outputTailChars, 500, 20000, 4000),
    cwd: typeof config?.cwd === 'string' ? config.cwd.trim() : '',
    detect: config?.detect !== false,
  }
}

/**
 * Clamp an integer configuration value.
 * @param {unknown} value - candidate.
 * @param {number} min - lower bound.
 * @param {number} max - upper bound.
 * @param {number} fallback - default.
 * @returns {number} a bounded integer.
 */
function clampInteger(value, min, max, fallback) {
  const numeric = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numeric)) return fallback
  return Math.min(max, Math.max(min, Math.trunc(numeric)))
}

/**
 * Host-side Green Loop service. Exposed as `ctx.greenLoop`.
 */
export default class GreenLoopPlugin extends Service {
  /** Services required before the plugin activates. */
  static inject = ['tools', 'commands', 'shell', 'agents']

  /**
   * @param {import('@deepseek-ai/cordis').Context} ctx - plugin context.
   * @param {Partial<z.infer<typeof Config>> | undefined} config - validated row config.
   */
  constructor(ctx, config) {
    super(ctx, 'greenLoop')
    this.config = resolveConfig(config)
    this.engine = new GreenLoopEngine({
      shell: ctx.shell,
      config: this.config,
      createMessage: (text) => createUserMessage({
        content: [{ type: 'text', text }],
        source: { kind: 'green-loop' },
      }),
      logger: { warn: (message) => this.#warn(message) },
    })
    this.#registerTools()
    this.#registerCommand()
    this.#listenForTurnStops()
    // The browser API is optional; a headless profile keeps the tools,
    // command, and turn-stopping loop without a dock.
    ctx.inject(['webServer', 'connection'], (transportCtx) => {
      this.#registerRoutes(transportCtx)
    })
  }

  /**
   * State for one session, for other plugins and tests.
   * @param {string} sessionId - session identity.
   * @returns {any} detached public state.
   */
  status(sessionId) {
    return this.engine.status(sessionId)
  }

  /**
   * Register the two model tools. The agent can probe the check before
   * claiming completion; arming stays a user decision.
   */
  #registerTools() {
    const engine = this.engine

    this.ctx.tools.register(defineTool({
      name: 'green_check',
      description: 'Run the project Green Loop check command (configured or auto-detected) and return pass/fail plus the output tail. Use it before claiming a coding task is complete.',
      parameters: {},
      output: {
        schema: { type: 'json' },
        render: (_args, value) => [{ type: 'text', text: formatCheckResult(value) }],
      },
      async execute(_args, exec) {
        const result = await engine.check(exec.agent)
        const value = {
          ok: result.ok,
          exitCode: result.exitCode,
          timedOut: result.timedOut,
          aborted: result.aborted,
          durationMs: result.durationMs,
          command: result.command,
          output: result.output,
        }
        // The canonical value must be lossless JSON: omit an absent error
        // instead of publishing an `undefined` property.
        if (typeof result.error === 'string' && result.error.length > 0) value.error = result.error
        return value
      },
    }))

    this.ctx.tools.register(defineTool({
      name: 'green_status',
      description: 'Report the current Green Loop state for this session: armed, running, attempts, resolved check command, and the last result.',
      parameters: {},
      output: {
        schema: { type: 'json' },
        render: (_args, value) => [{
          type: 'text',
          text: value.last?.output
            ? `${formatState(value)}\n\nLast output:\n${value.last.output}`
            : formatState(value),
        }],
      },
      async execute(_args, exec) {
        const state = engine.status(exec.agent.session.header.id)
        return {
          armed: state.armed,
          running: state.running,
          status: state.status,
          attempts: state.attempts,
          maxAttempts: state.maxAttempts,
          command: state.command,
          commandSource: state.commandSource,
          cwd: state.cwd,
          last: state.last === null ? null : {
            ok: state.last.ok,
            exitCode: state.last.exitCode,
            timedOut: state.last.timedOut,
            durationMs: state.last.durationMs,
            output: state.last.output,
            at: state.last.at,
          },
          error: state.error,
        }
      },
    }))
  }

  /**
   * Register `/green` for direct human control.
   */
  #registerCommand() {
    const engine = this.engine
    this.ctx.commands.register({
      name: 'green',
      description: 'Arm, inspect, or run the Green Loop test/fix loop.',
      input: { hint: '[start | stop | run | status]' },
      async handler({ agent, rawInput }) {
        const command = typeof rawInput === 'string' ? rawInput.trim().split(/\s+/)[0]?.toLowerCase() ?? '' : ''
        try {
          if (command === 'start' || command === 'arm') {
            const state = await engine.arm(agent)
            return {
              kind: 'success',
              text: `Green Loop armed. Check: ${state.command} (${state.commandSource ?? 'config'})\nIt runs when the next turn stops; failing checks are sent back to the agent.`,
            }
          }
          if (command === 'stop' || command === 'off' || command === 'disarm') {
            const state = engine.disarm(agent.session.header.id)
            return { kind: 'success', text: `Green Loop stopped. ${formatState(state)}` }
          }
          if (command === 'run' || command === 'now') {
            const state = await engine.runNow(agent)
            const last = state.last
            return {
              kind: state.status === 'error' ? 'error' : 'success',
              text: last === null
                ? formatState(state)
                : `${formatCheckResult(last)}\n\n${state.armed ? 'Failure sent to the agent; the loop will check again when the turn stops.' : formatState(state)}`,
            }
          }
          if (command === '' || command === 'status') {
            const state = engine.status(agent.session.header.id)
            return { kind: 'success', text: formatState(state) }
          }
          return {
            kind: 'error',
            text: 'Usage: /green [status | start | stop | run]',
          }
        } catch (error) {
          return {
            kind: 'error',
            text: error instanceof GreenLoopError ? error.message : `Green Loop failed: ${messageOf(error)}`,
          }
        }
      },
    })
  }

  /**
   * Rerun the check whenever a turn is about to close and this session is armed.
   * Steering inside the hook keeps the turn open and lets the agent fix the
   * failure before finishing.
   */
  #listenForTurnStops() {
    this.ctx.on('agent/turn-stopping', async (payload) => {
      try {
        await this.engine.handleTurnStopping(payload.agent, payload.signal)
      } catch (error) {
        this.#warn(`turn-stopping check failed: ${messageOf(error)}`)
      }
    })
  }

  /**
   * Register the authenticated browser API.
   * @param {import('@deepseek-ai/cordis').Context} transportCtx - context with `webServer` and `connection`.
   */
  #registerRoutes(transportCtx) {
    const engine = this.engine
    transportCtx.effect(() => transportCtx.webServer.register({
      kind: 'prefix',
      path: API_PREFIX,
      handler: async (req, res) => {
        const rejection = transportCtx.connection.requestRejection(req)
        if (rejection !== undefined) {
          const status = typeof rejection === 'number' ? rejection : 403
          sendJson(res, status, { ok: false, error: { code: 'forbidden', message: 'forbidden' } })
          return
        }
        const url = new URL(req.url ?? '/', 'http://dsh.internal')
        const method = url.pathname.slice(API_PREFIX.length).replace(/^\/+/, '').replace(/\/+$/, '')
        try {
          if (method === 'state' && req.method === 'GET') {
            const sessionId = url.searchParams.get('sessionId') ?? ''
            if (!validSessionId(sessionId)) {
              sendJson(res, 400, { ok: false, error: { code: 'invalid-session', message: 'sessionId is required' } })
              return
            }
            sendJson(res, 200, { ok: true, state: engine.status(sessionId) })
            return
          }
          if (method === 'arm' && req.method === 'POST') {
            const body = await readJson(req)
            const agent = this.#requireAgent(body.sessionId)
            const state = await engine.arm(agent)
            sendJson(res, 200, { ok: true, state })
            return
          }
          if (method === 'disarm' && req.method === 'POST') {
            const body = await readJson(req)
            if (!validSessionId(body.sessionId)) {
              sendJson(res, 400, { ok: false, error: { code: 'invalid-session', message: 'sessionId is required' } })
              return
            }
            sendJson(res, 200, { ok: true, state: engine.disarm(body.sessionId) })
            return
          }
          if (method === 'run' && req.method === 'POST') {
            const body = await readJson(req)
            const agent = this.#requireAgent(body.sessionId)
            const prepared = await engine.prepareRun(agent)
            void engine.runNow(agent).catch((error) => {
              this.#warn(`background run failed: ${messageOf(error)}`)
            })
            sendJson(res, 202, { ok: true, started: true, state: prepared })
            return
          }
          sendJson(res, 404, { ok: false, error: { code: 'not-found', message: 'unknown Green Loop API method' } })
        } catch (error) {
          const code = error instanceof GreenLoopError ? error.code : 'internal'
          const status = error instanceof GreenLoopError
            ? error.code === 'busy' ? 409 : error.code === 'session-not-found' ? 409 : 400
            : 500
          if (status === 500) this.#warn(`API failure: ${messageOf(error)}`)
          sendJson(res, status, { ok: false, error: { code, message: messageOf(error) } })
        }
      },
    }), 'green-loop: browser API')
  }

  /**
   * Resolve one active agent for an API action.
   * @param {unknown} sessionId - requested session id.
   * @returns {any} live agent.
   */
  #requireAgent(sessionId) {
    if (!validSessionId(sessionId)) {
      throw new GreenLoopError('invalid-session', 'sessionId is required')
    }
    const agent = this.ctx.agents.get(sessionId)
    if (agent === undefined) {
      throw new GreenLoopError('session-not-found', `session "${sessionId}" is not active`)
    }
    return agent
  }

  /**
   * Log a warning through the plugin logger when available.
   * @param {string} message - diagnostic text.
   */
  #warn(message) {
    try {
      const logger = this.ctx.logger
      if (typeof logger?.warn === 'function') logger.warn(`[green-loop] ${message}`)
      else console.warn(`[green-loop] ${message}`)
    } catch {
      console.warn(`[green-loop] ${message}`)
    }
  }
}

/**
 * @param {unknown} value - candidate session id.
 * @returns {boolean} whether it is a plausible non-empty session id.
 */
function validSessionId(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 128
}

/**
 * Read a bounded JSON object body.
 * @param {import('node:http').IncomingMessage} req - request stream.
 * @returns {Promise<Record<string, unknown>>} parsed object.
 */
async function readJson(req) {
  const declared = Number(req.headers['content-length'])
  if (Number.isFinite(declared) && declared > API_BODY_LIMIT) {
    throw new GreenLoopError('request-too-large', `request body exceeds ${API_BODY_LIMIT} bytes`)
  }
  /** @type {Buffer[]} */
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > API_BODY_LIMIT) {
      throw new GreenLoopError('request-too-large', `request body exceeds ${API_BODY_LIMIT} bytes`)
    }
    chunks.push(buffer)
  }
  if (size === 0) return {}
  let parsed
  try {
    parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw new GreenLoopError('invalid-json', 'request body must be valid JSON')
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new GreenLoopError('invalid-json', 'request body must be a JSON object')
  }
  return parsed
}

/**
 * Write one JSON response.
 * @param {import('node:http').ServerResponse} res - response sink.
 * @param {number} status - HTTP status.
 * @param {Record<string, unknown>} payload - JSON body.
 */
function sendJson(res, status, payload) {
  if (res.headersSent || res.writableEnded) return
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  })
  res.end(body)
}
