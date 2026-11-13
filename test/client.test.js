import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { after, before, test } from 'node:test'

/**
 * Load the browser bundle in a stub realm and capture its factory/registrations.
 * @returns {Promise<any>} captured client fixture.
 */
async function loadClient() {
  const source = await readFile(new URL('../client.js', import.meta.url), 'utf8')
  /** @type {any} */
  const captured = { config: null, exports: null, localeCalls: [], registrations: [], effects: 0, styles: [] }

  globalThis.window = {
    __ModuleLoader__: {
      load(config) {
        captured.config = config
      },
    },
  }
  globalThis.document = {
    baseURI: 'http://127.0.0.1:3000/',
    createElement() {
      return {
        setAttribute() {},
        textContent: '',
        remove() {},
      }
    },
    head: {
      appendChild(node) {
        captured.styles.push(node)
      },
    },
  }

  // eslint-disable-next-line no-new-func
  new Function(source)()

  const React = {
    createElement: (type, props, ...children) => ({ type, props, children }),
    useState: () => [{}, () => {}],
    useEffect: () => {},
    useCallback: (fn) => fn,
    useRef: (value) => ({ current: value }),
  }
  const module = captured.config.factory((specifier) => {
    if (specifier === 'react') return React
    throw new Error(`unexpected module: ${specifier}`)
  })
  captured.exports = module

  const ctx = {
    effect(fn) {
      captured.effects += 1
      const dispose = fn()
      assert.equal(typeof dispose, 'function')
      return dispose
    },
    locale: {
      register(ns, dictionaries) {
        captured.localeCalls.push({ ns, dictionaries })
        return () => {}
      },
    },
    slots: {
      inject(owner, callback) {
        assert.equal(owner, 'conversation.input.dock')
        callback()
      },
      register(spec, component) {
        captured.registrations.push({ spec, component })
        return () => {}
      },
    },
  }
  module.apply(ctx)
  return captured
}

let loaded

before(async () => {
  loaded = await loadClient()
})

after(() => {
  delete globalThis.window
  delete globalThis.document
})

test('registers a lazy factory whose id matches the package name', () => {
  assert.equal(loaded.config.id, 'dsh-green-loop')
  assert.equal(typeof loaded.config.factory, 'function')
})

test('declares the client services it uses', () => {
  assert.deepEqual(loaded.exports.inject, ['slots', 'locale'])
})

test('registers both baseline locale dictionaries', () => {
  assert.equal(loaded.localeCalls.length, 1)
  const [{ ns, dictionaries }] = loaded.localeCalls
  assert.equal(ns, 'green-loop')
  assert.ok(dictionaries.zh)
  assert.ok(dictionaries.en)
  assert.deepEqual(Object.keys(dictionaries.zh).sort(), Object.keys(dictionaries.en).sort())
})

test('contributes the dock entry with a session inject face', () => {
  assert.equal(loaded.registrations.length, 1)
  const [{ spec, component }] = loaded.registrations
  assert.equal(spec.name, 'conversation.input.dock')
  assert.equal(spec.id, 'green-loop')
  assert.equal(spec.order, 30)
  assert.equal(spec.locale, 'green-loop')
  assert.deepEqual(spec.inject('session-1'), { sessionId: 'session-1' })
  assert.equal(typeof component, 'function')
})

test('installs exactly one style element while active', () => {
  assert.equal(loaded.styles.length, 1)
  assert.equal(loaded.effects, 2)
})
