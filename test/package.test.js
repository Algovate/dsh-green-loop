import assert from 'node:assert/strict'
import { access, readFile } from 'node:fs/promises'
import { test } from 'node:test'

const root = new URL('../', import.meta.url)

/**
 * @param {string} path - package-relative path.
 * @returns {Promise<boolean>} whether it exists.
 */
async function exists(path) {
  try {
    await access(new URL(path, root))
    return true
  } catch {
    return false
  }
}

/**
 * @param {string} path - package-relative path.
 * @returns {Promise<any>} parsed JSON.
 */
async function json(path) {
  return JSON.parse(await readFile(new URL(path, root), 'utf8'))
}

const pkg = await json('package.json')

test('manifest declares a bundle patch, a web client, and compatibility', () => {
  assert.equal(pkg.name, 'dsh-green-loop')
  assert.match(pkg.version, /^0\.1\.0$/)
  assert.equal(pkg.type, 'module')
  assert.equal(pkg.dsh.bundle.patch, './cordis.patch.yml')
  assert.equal(pkg.dsh.client.platform, 'web')
  assert.equal(pkg.dsh.client.immediately, true)
  assert.deepEqual(pkg.dsh.client.inject, [
    '@deepseek-ai/dsh-client-ui-conversation',
    '@deepseek-ai/dsh-client-locale',
  ])
  assert.equal(pkg.dsh.manifestVersion, 1)
  assert.match(pkg.engines.dsh, /0\.2\.2/)
  assert.equal(pkg.license, 'MIT')
})

test('exports every runtime entry the loader needs', async () => {
  assert.equal(pkg.exports['.'], './index.js')
  assert.equal(pkg.exports['./client'], './client.js')
  for (const file of ['index.js', 'client.js', 'engine.js', 'detect.js', 'loop.js', 'cordis.patch.yml', 'icon.svg']) {
    assert.equal(await exists(file), true, `${file} must exist`)
  }
})

test('the patch inserts the package row', async () => {
  const patch = await readFile(new URL('cordis.patch.yml', root), 'utf8')
  assert.match(patch, /id:\s*green-loop/)
  assert.match(patch, /name:\s*'dsh-green-loop'/)
})

test('both locales carry display metadata and a detail document', async () => {
  const en = await json('locale/en.json')
  const zh = await json('locale/zh.json')
  assert.equal(en.meta.title, 'Green Loop')
  assert.ok(en.meta.description.length > 20)
  assert.equal(en.meta.detail, 'docs/DETAIL.md')
  assert.equal(zh.meta.title, '绿循环')
  assert.ok(zh.meta.description.length > 10)
  assert.equal(zh.meta.detail, 'docs/DETAIL.zh.md')
  for (const file of ['docs/DETAIL.md', 'docs/DETAIL.zh.md', 'docs/dock.webp']) {
    assert.equal(await exists(file), true, `${file} must exist`)
  }
})

test('the icon is a self-contained SVG', async () => {
  const icon = await readFile(new URL('icon.svg', root), 'utf8')
  assert.match(icon, /^<svg[\s>]/)
  assert.doesNotMatch(icon, /<script/i)
})
