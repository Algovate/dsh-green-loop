# Release checklist

This package is prepared for an npm release and a DSH plugin-market listing. The public
repository and the 24-second demo GIF exist; the remaining steps need npm credentials and the
marketplace entry.

## Current status (2026-11-13)

- `npm publish --dry-run` passes; tarball is 46 kB / 21 files.
- `npm pack` produced `dsh-green-loop-0.1.0.tgz`.
- A **fresh temp profile** installed that tarball and imported the full plugin schema:
  `dsh plugin --profile gltest add ./dsh-green-loop-0.1.0.tgz` then
  `dsh --profile gltest --dump-config-schema` → exit 0, entry `green-loop` present.
- The Desktop profile is restored to the source **link** for development; the tarball is the
  release artifact.
- Replacing a linked install with a tarball in the **same running Host** can hit a stale module
  resolution cache (`@deepseek-ai/cordis` imported from the old source path). Install the tarball
  in a fresh profile or restart the Host after switching channels.
- npm name `dsh-green-loop` is available (registry returns 404).
- Public repository: https://github.com/Algovate/dsh-green-loop (main, CI green); `repository`,
  `homepage`, and `bugs` are set in `package.json`.
- Release tag: `v0.1.0`.
- Demo GIF: `docs/demo.gif` (960×540, 24 s, 12.5 fps, 2.1 MB), reproducible from
  `docs/demo.html`; uploaded as a release asset.

## 1. Identity

- [x] Create the public GitHub repository: https://github.com/Algovate/dsh-green-loop.
- [x] Add `repository`, `homepage`, and `bugs` to `package.json`; `author` is `Algovate`.
- [x] Confirm the npm name `dsh-green-loop` is available:
      `npm view dsh-green-loop version` → 404.
- [x] Push `main`; GitHub Actions CI is green.
- [x] Tag the release: `v0.1.0`.

## 2. Pre-flight

```sh
cd dsh-green-loop
node --test test/*.test.js
node --check index.js && node --check client.js && node --check engine.js \
  && node --check detect.js && node --check loop.js
npm pack --dry-run
```

Check the packed file list includes:

- `index.js`, `client.js`, `engine.js`, `detect.js`, `loop.js`
- `cordis.patch.yml`
- `locale/en.json`, `locale/zh.json`
- `icon.svg`
- `README.md`, `README.zh.md`, `CHANGELOG.md`, `SECURITY.md`, `LICENSE`
- `docs/DETAIL.md`, `docs/DETAIL.zh.md`, `docs/dock.webp`

The `files` field already includes these; `npm pack --dry-run` is the authority.

## 3. Publish

```sh
npm publish --access public
```

`prepublishOnly` reruns the tests and syntax checks. The package has no build step and no
install scripts, so it does not need a pnpm build allowance.

## 4. Install from the registry in a fresh profile

```sh
dsh plugin --profile <test-profile> add dsh-green-loop@0.1.0
dsh --profile <test-profile> --dump-config | grep -A2 'green-loop'
```

Then boot the Web profile, open a session, and confirm:

- the composer dock appears;
- **Arm** resolves a command;
- ending a turn runs the check;
- a pass turns the dock green;
- a deliberately failing check steers the agent (try a throwaway project).

## 5. Marketplace listing

The market index entry needs:

- package name and version (`dsh-green-loop`, `0.1.0`);
- `title` / `description` from `locale/{en,zh}.json` meta;
- `icon` (`icon.svg`);
- `repository` and `homepage`;
- `metadata.category`: `development`;
- `metadata.keywords`: `dsh`, `dsh-plugin`, `agent`, `testing`, `test`, `automation`, `tdd`,
  `green-loop`, `quality`;
- the version's `engines.dsh`;
- the detail document from `locale/*.json` `meta.detail` (`docs/DETAIL.md` / `docs/DETAIL.zh.md`).

Suggested listing copy:

> **Green Loop** — Arm once and let a coding agent keep fixing until the project's check
> command passes. Failed checks are steered back into the same turn; bounded attempts, timeout,
> and stall detection. Zero-config detection for Node, Python, Go, Rust, and Make.

## 6. Launch

- [x] Record the 24-second GIF: Arm → failing test → steering message → agent fixes → green dock.
- Post in the DSH community with the one-line promise, not “another test plugin”.
- Ask for five real users and iterate on the failure/steer experience first.
- Keep `updated-week` cadence for the first month; the market surfaces recent updates.

## 7. After release

- Bump the version and `CHANGELOG.md` for every behavior change.
- Validate compatibility against the current DSH release before claiming a new range.
- Never claim the market `verified` label; it is assigned by the index owner.
