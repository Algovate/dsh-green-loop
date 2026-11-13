import assert from 'node:assert/strict'
import { test } from 'node:test'
import { detectCheckCommand } from '../detect.js'

/**
 * Build an in-memory filesystem adapter.
 * @param {Record<string, string | true>} files - path suffix → content (true for directories).
 * @returns {{ exists: Function, readFile: Function, isDirectory: Function }} adapter.
 */
function fakeFs(files) {
  const keys = Object.keys(files)
  return {
    async exists(path) {
      return keys.some((key) => path.endsWith(`/${key}`) || path === key)
    },
    async readFile(path) {
      const key = keys.find((candidate) => path.endsWith(`/${candidate}`) || path === candidate)
      if (key === undefined || files[key] === true) throw new Error(`ENOENT ${path}`)
      return files[key]
    },
    async isDirectory(path) {
      if (path === '/repo') return true
      return keys.some((key) => files[key] === true && (path.endsWith(`/${key}`) || path === key))
    },
  }
}

test('detects a pnpm test script', async () => {
  const result = await detectCheckCommand('/repo', fakeFs({
    'package.json': JSON.stringify({ scripts: { test: 'vitest' } }),
    'pnpm-lock.yaml': '',
  }))
  assert.deepEqual(result, { command: 'pnpm test', source: 'package.json:scripts.test' })
})

test('detects npm, yarn, and bun package managers', async () => {
  const pkg = JSON.stringify({ scripts: { test: 'node --test' } })
  assert.equal((await detectCheckCommand('/repo', fakeFs({ 'package.json': pkg })))?.command, 'npm test')
  assert.equal((await detectCheckCommand('/repo', fakeFs({ 'package.json': pkg, 'yarn.lock': '' })))?.command, 'yarn test')
  assert.equal((await detectCheckCommand('/repo', fakeFs({ 'package.json': pkg, 'bun.lockb': '' })))?.command, 'bun run test')
})

test('ignores a package without a test script and finds a Makefile', async () => {
  const result = await detectCheckCommand('/repo', fakeFs({
    'package.json': JSON.stringify({ scripts: { build: 'tsc' } }),
    'Makefile': 'test:\n\techo ok\n',
  }))
  assert.deepEqual(result, { command: 'make test', source: 'Makefile:test' })
})

test('detects Python layouts and lockfiles', async () => {
  assert.equal((await detectCheckCommand('/repo', fakeFs({ 'pyproject.toml': '' })))?.command, 'pytest -q')
  assert.equal((await detectCheckCommand('/repo', fakeFs({ 'pyproject.toml': '', 'uv.lock': '' })))?.command, 'uv run pytest -q')
  assert.equal((await detectCheckCommand('/repo', fakeFs({ 'pytest.ini': '', 'poetry.lock': '' })))?.command, 'poetry run pytest -q')
})

test('detects Go and Rust projects', async () => {
  assert.equal((await detectCheckCommand('/repo', fakeFs({ 'go.mod': '' })))?.command, 'go test ./...')
  assert.equal((await detectCheckCommand('/repo', fakeFs({ 'Cargo.toml': '' })))?.command, 'cargo test')
})

test('returns null for unknown projects and non-directories', async () => {
  assert.equal(await detectCheckCommand('/repo', fakeFs({ 'README.md': '' })), null)
  assert.equal(await detectCheckCommand('/missing', fakeFs({})), null)
  assert.equal(await detectCheckCommand('', fakeFs({})), null)
})

test('a malformed package.json does not hide a Makefile', async () => {
  const result = await detectCheckCommand('/repo', fakeFs({
    'package.json': '{ not json',
    'Makefile': '.PHONY: test\ntest:\n\t@true\n',
  }))
  assert.equal(result?.command, 'make test')
})
