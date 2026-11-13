/**
 * Zero-config check-command detection for the Green Loop plugin.
 *
 * Detection only READS project metadata; it never executes anything. The user
 * still arms the loop, and the resolved command is shown in the dock before it
 * runs. An explicit `config.command` always wins.
 * @module dsh-green-loop/detect
 */

import { access, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'

/** Real filesystem adapter used by the detector. */
export const defaultFs = {
  /**
   * @param {string} path - absolute path.
   * @returns {Promise<boolean>} whether the path exists.
   */
  async exists(path) {
    try {
      await access(path)
      return true
    } catch {
      return false
    }
  },
  /**
   * @param {string} path - absolute path.
   * @returns {Promise<string>} UTF-8 file contents.
   */
  async readFile(path) {
    return await readFile(path, 'utf8')
  },
  /**
   * @param {string} path - absolute path.
   * @returns {Promise<boolean>} whether the path is a directory.
   */
  async isDirectory(path) {
    try {
      return (await stat(path)).isDirectory()
    } catch {
      return false
    }
  },
}

/**
 * Pick the package-manager command for a Node project.
 * @param {string} cwd - project root.
 * @param {{ exists: (path: string) => Promise<boolean> }} fs - filesystem adapter.
 * @returns {Promise<string>} `npm test`, `pnpm test`, `yarn test`, or `bun run test`.
 */
async function nodeTestCommand(cwd, fs) {
  if (await fs.exists(join(cwd, 'pnpm-lock.yaml'))) return 'pnpm test'
  if (await fs.exists(join(cwd, 'yarn.lock'))) return 'yarn test'
  if (await fs.exists(join(cwd, 'bun.lockb')) || await fs.exists(join(cwd, 'bun.lock'))) return 'bun run test'
  return 'npm test'
}

/**
 * Detect one check command for a project root.
 *
 * Order is deliberate: a Node test script is the strongest signal, then the
 * common Python/Go/Rust layouts, then a Makefile `test` target. The user can
 * always override with `config.command`.
 * @param {string} cwd - absolute project root.
 * @param {typeof defaultFs} [fs] - filesystem adapter, injectable for tests.
 * @returns {Promise<{ command: string, source: string } | null>} the command and where it came from.
 */
export async function detectCheckCommand(cwd, fs = defaultFs) {
  if (typeof cwd !== 'string' || cwd.trim().length === 0) return null
  if (typeof fs?.isDirectory === 'function' && !(await fs.isDirectory(cwd))) return null

  const packageJson = join(cwd, 'package.json')
  if (await fs.exists(packageJson)) {
    try {
      const parsed = JSON.parse(await fs.readFile(packageJson))
      const script = parsed?.scripts?.test
      if (typeof script === 'string' && script.trim().length > 0) {
        return { command: await nodeTestCommand(cwd, fs), source: 'package.json:scripts.test' }
      }
    } catch {
      // A malformed package.json is not a reason to skip other project types.
    }
  }

  const pythonMarkers = ['pyproject.toml', 'pytest.ini', 'tox.ini']
  let python = false
  for (const marker of pythonMarkers) {
    if (await fs.exists(join(cwd, marker))) {
      python = true
      break
    }
  }
  if (!python && await fs.isDirectory(join(cwd, 'tests'))) python = true
  if (python) {
    if (await fs.exists(join(cwd, 'uv.lock'))) return { command: 'uv run pytest -q', source: 'uv.lock' }
    if (await fs.exists(join(cwd, 'poetry.lock'))) return { command: 'poetry run pytest -q', source: 'poetry.lock' }
    return { command: 'pytest -q', source: 'pytest layout' }
  }

  if (await fs.exists(join(cwd, 'go.mod'))) return { command: 'go test ./...', source: 'go.mod' }
  if (await fs.exists(join(cwd, 'Cargo.toml'))) return { command: 'cargo test', source: 'Cargo.toml' }

  const makefile = join(cwd, 'Makefile')
  if (await fs.exists(makefile)) {
    try {
      const text = await fs.readFile(makefile)
      if (/^test\s*:/m.test(text)) return { command: 'make test', source: 'Makefile:test' }
    } catch {
      // Unreadable Makefile: no detection.
    }
  }

  return null
}
