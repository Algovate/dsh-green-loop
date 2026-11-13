/**
 * Green Loop — browser half.
 *
 * A compact composer dock that shows the per-session loop state and exposes
 * Arm / Disarm / Run now / Stop through the authenticated Host API. The Host
 * owns the loop; this file only renders and polls while a run is active.
 */
window.__ModuleLoader__.load({
  id: 'dsh-green-loop',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    /** Locale namespace owned by this plugin. */
    const NS = 'green-loop'

    /** Simplified Chinese dictionary (key-set source of truth). */
    const zh = {
      label: '绿循环',
      loading: '加载中',
      off: '未开启',
      armed: '已开启',
      running: '检查中',
      green: '已通过',
      red: '未通过',
      retrying: '修复中',
      stalled: '无进展，已停止',
      error: '出错',
      aborted: '已停止',
      stopped: '已停止',
      arm: '开启',
      disarm: '关闭',
      stop: '停止',
      runNow: '立即检查',
      details: '详情',
      hide: '收起',
      check: '检查命令',
      cwd: '工作目录',
      source: '来源',
      attempts: '尝试次数',
      lastOutput: '最近输出',
      noOutput: '（无输出）',
      autoDetect: '开启时自动检测',
      noCheck: '未配置检查命令',
      configured: '配置',
      detected: '自动检测',
      actionFailed: '操作失败',
      retry: '重试',
      pollFailed: '无法读取绿循环状态',
      hint: '开启后，每轮结束自动运行检查；失败会把输出回传给 Agent，直到通过或达到次数上限。',
    }

    /** English dictionary, checked against the same keys. */
    const en = {
      label: 'Green Loop',
      loading: 'Loading',
      off: 'Off',
      armed: 'Armed',
      running: 'Running',
      green: 'Green',
      red: 'Red',
      retrying: 'Fixing',
      stalled: 'No progress, stopped',
      error: 'Error',
      aborted: 'Stopped',
      stopped: 'Stopped',
      arm: 'Arm',
      disarm: 'Disarm',
      stop: 'Stop',
      runNow: 'Run now',
      details: 'Details',
      hide: 'Hide',
      check: 'Check',
      cwd: 'Working directory',
      source: 'Source',
      attempts: 'Attempts',
      lastOutput: 'Last output',
      noOutput: '(no output)',
      autoDetect: 'Auto-detect on arm',
      noCheck: 'No check configured',
      configured: 'Configured',
      detected: 'Detected',
      actionFailed: 'Action failed',
      retry: 'Retry',
      pollFailed: 'Could not read Green Loop state',
      hint: 'While armed, the check runs when each turn ends. Failures are sent back to the agent until the check passes or the attempt budget runs out.',
    }

    /** Styles installed once and removed when the plugin unloads. */
    const CSS = `
.gl-dock{box-sizing:border-box;width:100%;margin:0 auto}
.gl-inner{box-sizing:border-box;width:calc(100% - var(--dsh-composer-side-clearance, 0px) - var(--dsh-composer-side-clearance, 0px) - var(--dsh-composer-dock-inset, 0px) - var(--dsh-composer-dock-inset, 0px) - var(--dsh-composer-dock-inset, 0px) - var(--dsh-composer-dock-inset, 0px));max-width:calc(var(--dsh-composer-card-max-width, 748px) - var(--dsh-composer-dock-inset, 0px) - var(--dsh-composer-dock-inset, 0px) - var(--dsh-composer-dock-inset, 0px) - var(--dsh-composer-dock-inset, 0px));margin:0 auto}
.gl-row{display:flex;align-items:center;gap:6px;min-height:28px;padding:0 2px;overflow-x:auto;scrollbar-width:none}
.gl-row::-webkit-scrollbar{display:none}
.gl-label{display:inline-flex;align-items:center;gap:5px;flex:none;padding:0 2px;color:var(--dsw-alias-label-tertiary, inherit);font-family:inherit;font-size:11px;line-height:16px;letter-spacing:.02em;white-space:nowrap}
.gl-label svg{width:13px;height:13px;flex:none}
.gl-dot{flex:none;width:7px;height:7px;border-radius:50%;corner-shape:round;background:var(--dsw-alias-label-tertiary, currentColor)}
.gl-dot[data-status="armed"]{background:var(--dsw-alias-state-business-primary, currentColor)}
.gl-dot[data-status="green"]{background:var(--dsw-alias-state-success-primary, currentColor)}
.gl-dot[data-status="error"]{background:var(--dsw-alias-state-error-primary, currentColor)}
.gl-dot[data-status="running"]{background:var(--dsw-alias-state-business-primary, currentColor);animation:gl-pulse 1.2s ease-in-out infinite}
@keyframes gl-pulse{0%,100%{opacity:1}50%{opacity:.35}}
@media (prefers-reduced-motion: reduce){.gl-dot[data-status="running"]{animation:none}}
.gl-status{flex:none;color:var(--dsw-alias-label-secondary, inherit);font-family:inherit;font-size:12px;line-height:18px;white-space:nowrap}
.gl-command{min-width:0;max-width:220px;overflow:hidden;color:var(--dsw-alias-label-tertiary, inherit);font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;line-height:16px;white-space:nowrap;text-overflow:ellipsis}
.gl-actions{display:flex;align-items:center;gap:6px;flex:none;margin-left:auto}
.gl-btn{appearance:none;flex:none;padding:3px 9px;border:0.5px solid var(--dsw-alias-border-l3, transparent);border-radius:999px;corner-shape:round;background:transparent;color:var(--dsw-alias-label-secondary, inherit);font-family:inherit;font-size:12px;line-height:18px;cursor:pointer}
.gl-btn:disabled{cursor:default;opacity:.45}
.gl-btn:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary, currentColor);outline-offset:2px}
.gl-btn[data-tone="primary"]{border-color:var(--dsw-alias-state-business-primary, transparent);color:var(--dsw-alias-state-business-primary, inherit)}
.gl-btn[data-tone="danger"]{border-color:var(--dsw-alias-state-error-primary, transparent);color:var(--dsw-alias-state-error-primary, inherit)}
.gl-notice{padding:2px 4px 0;color:var(--dsw-alias-state-error-primary, inherit);font-family:inherit;font-size:11px;line-height:16px}
.gl-details{display:grid;gap:6px;margin-top:8px;padding:10px 12px;border:0.5px solid var(--dsw-alias-border-l1, transparent);border-radius:var(--dsw-radius-md, 12px);background:var(--dsw-alias-bg-layer-2, transparent)}
.gl-kv{display:flex;gap:8px;align-items:baseline;min-width:0;font-family:inherit;font-size:11px;line-height:16px}
.gl-kv>span:first-child{flex:none;color:var(--dsw-alias-label-tertiary, inherit)}
.gl-kv code,.gl-kv>span:last-child{min-width:0;overflow:hidden;color:var(--dsw-alias-label-secondary, inherit);font-family:ui-monospace,SFMono-Regular,Menlo,monospace;white-space:nowrap;text-overflow:ellipsis}
.gl-pre{max-height:180px;margin:2px 0 0;overflow:auto;padding:8px;border-radius:8px;background:var(--dsw-alias-bg-base, transparent);color:var(--dsw-alias-label-secondary, inherit);font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;line-height:16px;white-space:pre-wrap;word-break:break-word}
@media (hover:hover){
.gl-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover, transparent);color:var(--dsw-alias-label-primary, inherit)}
.gl-btn[data-tone="primary"]:hover:not(:disabled){color:var(--dsw-alias-state-business-primary, inherit)}
.gl-btn[data-tone="danger"]:hover:not(:disabled){color:var(--dsw-alias-state-error-primary, inherit)}
}
`

    /**
     * Resolve a Host route against the page base.
     * @param {string} path - route below the page base.
     * @returns {URL} absolute same-origin URL.
     */
    function routeUrl(path) {
      const base = typeof document !== 'undefined' && typeof document.baseURI === 'string' && document.baseURI.length > 0
        ? document.baseURI
        : 'http://dsh.internal/'
      const url = new URL(base)
      url.search = ''
      url.hash = ''
      if (!url.pathname.endsWith('/')) url.pathname += '/'
      return new URL(String(path).replace(/^\/+/, ''), url)
    }

    /**
     * Call one Green Loop API method.
     * @param {'GET'|'POST'} method - HTTP method.
     * @param {string} action - route below `/green-loop/api/`.
     * @param {Record<string, unknown>} [payload] - JSON body.
     * @returns {Promise<any>} decoded body.
     */
    async function request(method, action, payload) {
      const init = {
        method,
        credentials: 'same-origin',
        headers: { accept: 'application/json' },
      }
      if (payload !== undefined) {
        init.headers['content-type'] = 'application/json'
        init.body = JSON.stringify(payload)
      }
      const response = await fetch(routeUrl(`green-loop/api/${action}`), init)
      let data = null
      try {
        data = await response.json()
      } catch {
        // Proxies and auth responses may not be JSON.
      }
      if (!response.ok || data === null || data.ok !== true) {
        const message = data?.error?.message
        throw new Error(typeof message === 'string' && message.length > 0 ? message : `HTTP ${response.status}`)
      }
      return data
    }

    /**
     * @param {unknown} error - thrown value.
     * @returns {string} display message.
     */
    function messageOf(error) {
      return error instanceof Error && error.message.length > 0 ? error.message : String(error)
    }

    /** Small loop mark for the dock label. */
    function LoopIcon() {
      return h('svg', { viewBox: '0 0 20 20', 'aria-hidden': 'true', focusable: 'false' },
        h('path', {
          d: 'M4 10a6 6 0 1 1 1.9 4.4',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: '1.5',
          strokeLinecap: 'round',
        }),
        h('path', {
          d: 'M4 5.5V10h4.5',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: '1.5',
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
        }),
        h('path', {
          d: 'm8 10 2 2 3.5-4',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: '1.5',
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
        }),
      )
    }

    /**
     * Composer dock for one session.
     * @param {{ sessionId: string, t?: (key: string) => string }} props - slot props.
     * @returns {import('react').ReactElement} dock tree.
     */
    function GreenLoopDock(props) {
      const t = typeof props.t === 'function' ? props.t : (key) => key
      const sessionId = props.sessionId
      const [state, setState] = React.useState(null)
      const [loading, setLoading] = React.useState(true)
      const [busy, setBusy] = React.useState(false)
      const [error, setError] = React.useState(null)
      const [open, setOpen] = React.useState(false)
      const alive = React.useRef(true)

      const refresh = React.useCallback(async () => {
        try {
          const data = await request('GET', `state?sessionId=${encodeURIComponent(sessionId)}`)
          if (!alive.current) return
          setState(data.state)
          setLoading(false)
          setError(null)
        } catch (failure) {
          if (!alive.current) return
          setLoading(false)
          setError(`${t('pollFailed')}: ${messageOf(failure)}`)
        }
      }, [sessionId, t])

      React.useEffect(() => {
        alive.current = true
        void refresh()
        return () => { alive.current = false }
      }, [refresh])

      const active = state !== null && (state.armed === true || state.running === true)
      React.useEffect(() => {
        if (!active) return undefined
        const timer = setInterval(() => { void refresh() }, 1200)
        return () => clearInterval(timer)
      }, [active, refresh])

      /**
       * Run one UI action against the Host API.
       * @param {'arm'|'disarm'|'run'} action - action route.
       */
      const act = async (action) => {
        if (busy) return
        setBusy(true)
        setError(null)
        try {
          const data = await request('POST', action, { sessionId })
          if (data.state) setState(data.state)
          await refresh()
        } catch (failure) {
          setError(messageOf(failure))
        } finally {
          setBusy(false)
        }
      }

      const status = state?.status ?? 'off'
      const armed = state?.armed === true
      const running = state?.running === true
      const attempts = Number(state?.attempts ?? 0)
      const maxAttempts = Number(state?.maxAttempts ?? 3)
      const detail = attempts > 0 ? ` · ${attempts}/${maxAttempts}` : ''
      const statusLabel = running
        ? t('running')
        : armed
          ? status === 'red' ? t('retrying') : t('armed')
          : status === 'green'
            ? t('green')
            : status === 'red'
              ? t('red')
              : status === 'stalled'
                ? t('stalled')
                : status === 'error'
                  ? t('error')
                  : status === 'aborted'
                    ? t('aborted')
                    : t('off')
      const dotStatus = running ? 'running' : armed ? 'armed' : status === 'green' ? 'green' : status === 'red' || status === 'stalled' || status === 'error' ? 'error' : 'off'
      const command = state?.command ?? ''
      const commandText = command.length > 0
        ? command
        : state?.detect === false
          ? t('noCheck')
          : t('autoDetect')
      const sourceText = state?.commandSource === 'config'
        ? t('configured')
        : state?.commandSource
          ? `${t('detected')} · ${state.commandSource}`
          : '—'
      const actionError = error ?? state?.error ?? null
      const canArm = loading || busy || running || (state !== null && state.configured === false && state.detect === false)

      return h('div', { className: 'gl-dock' },
        h('div', { className: 'gl-inner' },
          h('div', { className: 'gl-row', role: 'group', 'aria-label': t('label') },
            h('span', { className: 'gl-label' }, h(LoopIcon), t('label')),
            h('span', { className: 'gl-dot', 'data-status': dotStatus, 'aria-hidden': 'true' }),
            h('span', { className: 'gl-status', title: state?.error ?? undefined },
              loading ? t('loading') : `${statusLabel}${detail}`),
            h('span', { className: 'gl-command', title: commandText }, commandText),
            h('span', { className: 'gl-actions' },
              running
                ? h('button', { type: 'button', className: 'gl-btn', 'data-tone': 'danger', disabled: busy, onClick: () => void act('disarm') }, t('stop'))
                : armed
                  ? h('button', { type: 'button', className: 'gl-btn', disabled: busy, onClick: () => void act('disarm') }, t('disarm'))
                  : h('button', {
                      type: 'button',
                      className: 'gl-btn',
                      'data-tone': 'primary',
                      disabled: canArm,
                      onClick: () => void act('arm'),
                    }, t('arm')),
              h('button', {
                type: 'button',
                className: 'gl-btn',
                disabled: busy || running || (state !== null && state.configured === false && state.detect === false),
                onClick: () => void act('run'),
              }, t('runNow')),
              state === null && error !== null
                ? h('button', {
                    type: 'button',
                    className: 'gl-btn',
                    disabled: busy,
                    onClick: () => { setLoading(true); void refresh() },
                  }, t('retry'))
                : null,
              h('button', {
                type: 'button',
                className: 'gl-btn',
                'aria-expanded': open,
                onClick: () => setOpen((value) => !value),
              }, open ? t('hide') : t('details')),
            ),
          ),
          actionError
            ? h('div', { className: 'gl-notice', role: 'alert' }, actionError)
            : null,
          open
            ? h('div', { className: 'gl-details' },
                h('div', { className: 'gl-kv' }, h('span', null, t('check')), h('code', { title: command }, command || '—')),
                h('div', { className: 'gl-kv' }, h('span', null, t('cwd')), h('code', { title: state?.cwd ?? '' }, state?.cwd ?? '—')),
                h('div', { className: 'gl-kv' }, h('span', null, t('source')), h('span', null, sourceText)),
                h('div', { className: 'gl-kv' }, h('span', null, t('attempts')), h('span', null, `${attempts}/${maxAttempts}`)),
                h('div', { className: 'gl-kv' }, h('span', null, t('lastOutput')), h('span', null, state?.last?.at ? new Date(state.last.at).toLocaleTimeString() : '—')),
                h('pre', { className: 'gl-pre' }, state?.last?.output || t('noOutput')),
                h('div', { className: 'gl-kv' }, h('span', null, t('hint'))),
              )
            : null,
        ),
      )
    }

    /**
     * Client plugin body.
     * @param {import('@deepseek-ai/cordis').Context} ctx - client context.
     */
    function apply(ctx) {
      ctx.effect(() => {
        const style = document.createElement('style')
        style.setAttribute('data-dsh-plugin', 'green-loop')
        style.textContent = CSS
        document.head.appendChild(style)
        return () => { style.remove() }
      }, 'green-loop: styles')

      ctx.effect(
        () => ctx.locale.register(NS, { zh, en }),
        'green-loop: dictionaries',
      )

      ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
        name: 'conversation.input.dock',
        id: 'green-loop',
        order: 30,
        locale: NS,
        inject: (sessionId) => ({ sessionId }),
      }, GreenLoopDock))
    }

    return {
      inject: ['slots', 'locale'],
      apply,
      GreenLoopDock,
    }
  },
})
