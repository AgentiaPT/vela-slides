---
name: dependency-sweep
description: Run a global dependency bump across every ecosystem in this repo (npm, GitHub Actions, pip, docker, Go, the Neutralino runtime) with supply-chain cooldowns enforced. Use when asked to bump dependencies, clear dependabot PRs, sweep updates, check for vulnerable dependencies, or audit the supply chain. Starts from a deterministic script so only the judgement calls cost reasoning.
---

# Dependency sweep

**Run the script first. Do not re-derive by hand what it already computed.**

```bash
python3 tools/vela-dev/scripts/dep-sweep.py --vet --upgrades --base origin/main --json
```

`--upgrades` also scans for newer GitHub Action tags (adds ~15s). Do not skip
it: without it the report verifies that each pin matches its tag and says
nothing about whether that tag is still current — an action can be correctly
pinned to a release upstream has since superseded for security reasons.

That one command replaces roughly 80% of this task: manifest discovery,
per-tier cooldown maths, Action pin verification, provenance and publisher
checks, install-hook diffing, new-package detection, lockfile parity and the
three audits. It takes ~10s. Read its output, then spend your reasoning only
on what it deliberately leaves open.

Exit codes: `0` clean · `1` findings · `4` **anything at high/critical
severity**. That is broader than just integrity failures: a bad Action pin, a
lockfile parity break, an end-of-life Go toolchain, and live high-severity
advisories from `npm`/`pnpm audit` all exit 4. Read which finding caused it
before assuming the tooling misfired.

## What the script decides, and what you decide

| The script settles | You must judge |
|---|---|
| Which versions have cleared their cooldown tier | **Which eligible version to actually take** |
| That a pin matches its upstream tag | Whether a major is in scope at all |
| Provenance / publisher / hook deltas | Whether to spend the security exemption |
| Advisory counts per tree | What a release note means *for this repo's usage* |
| Newer Action tags (with `--upgrades`) | Whether an Action major changes behaviour you rely on |
| That the Go toolchain is EOL | Which supported Go line to land on |

### The judgement calls that recur

1. **Newest eligible vs. last patch of a line.** The report flags
   `X is eligible but already superseded by Y (still in cooldown)`. Taking X
   means shipping a version its own maintainers already patched. Usually prefer
   the newest version that is *both* past cooldown and the final patch of its
   line — even if that means staying a minor behind.
2. **Cooldown is measured against the TARGET version's release date**, for the
   whole jump. `1.60.0 → 1.62.1` is a **minor** update, so 1.62.1 needs 14 days
   — not 7 because `.1` looks like a patch. The script gets this right; don't
   second-guess it into taking something fresher.
3. **The security exemption is real but must be earned.** `.github/dependabot.yml`
   exempts security fixes from cooldown. Only spend it when the version *is* the
   fix for a live advisory and no patched release also clears the tier. Check
   for an older patched version first. State the shortfall explicitly in the
   commit message — never imply full compliance you did not have.
4. **Transitive advisories usually are not fixed by bumping the direct dep.**
   Refresh transitives within existing ranges first (`pnpm update --lockfile-only`).
   Only move the parent when its declared range cannot reach the patched version.
5. **`overrides` to pin a transitive is almost always wrong** — it masks future
   upstream fixes. Prefer a documented exemption.

## Non-negotiables

- **Never** take a version that fails cooldown without a security justification
  written into the commit message.
- **Keep both root lockfiles in step.** `npm ci` drives CI; `pnpm` has its own
  floor. After changing either, re-run the script — parity is a hard finding.
  To pin an exact version despite a caret range, install it explicitly
  (`npm install pkg@X --package-lock-only`, `pnpm add pkg@X --lockfile-only`);
  a plain install resolves to the newest match and will undo your choice.
- **`pnpm update` rewrites specs in package.json.** Check the diff and restore
  any spec you meant to hold back. Prefer targeting the packages you actually
  mean to move (`pnpm update <pkg> --lockfile-only`) over a bare `pnpm update`,
  which will also drag direct deps past their cooldown.
- **Never run a bare `pnpm install` inside `vela-neutralino/`.** It walks up to
  the root `pnpm-workspace.yaml` and silently rewrites the ROOT
  `pnpm-lock.yaml`. Always use `--ignore-workspace`, exactly as
  `_build-desktop.yml` does. Check `git status` afterwards regardless.
- **Version bump:** only needed if `skills/vela-slides/` or `src/parts/` changed.
  A pure dependency sweep touches neither, so no `VELA_VERSION` bump.
- **Disclosure discipline** (CLAUDE.md): describe security fixes by class and
  effect. No payloads, no reproduction steps, no session URLs — public repo.

## Ecosystems the script reports but cannot bump

- **Neutralino runtime** (`vela-neutralino/neutralino.config.json`) — bump
  `binaryVersion`/`clientVersion`, run `neu update`, regenerate
  `checksums/*.sha256`, and **verify over two independent fetch paths** (the
  `neu update` result vs. a direct release download) before committing pins.
  Check new upstream APIs against `nativeAllowList` — it is a strict allowlist,
  so additions are unreachable unless explicitly added.
- **Go toolchain** — `go.mod`, `go-version:` in workflows, and the Dockerfile
  base image must move together.
- **Vendored UMD bundles** (`vela-neutralino/resources/vendor/*.js`) — react,
  react-dom, lucide-react and babel, shipped inside the desktop binary and
  covered by no lockfile. **Bumping the npm versions of these does nothing to
  the desktop shell**; the vendored copies must be re-vendored and re-hashed by
  hand or they silently drift. Identify a version by hashing the file against
  upstream tarballs; do not guess from strings inside the bundle.
- **pip transitives** — pinning `python-pptx` does not pin Pillow/lxml.

## Finish

Run the repo's gate before committing:

```bash
python3 tests/test_vela.py                      # 488
python3 tests/test_vela.py --integration        # 102
python3 tests/test_serve.py                     # 124
python3 -m unittest tests.test_desktop          # 35
node tests/test_release_build.cjs               # 22
python3 -m unittest tests.test_dep_sweep        # 40 (this tooling)
python3 tools/vela-dev/scripts/concat.py        # template must stay in sync
```

Then re-run `dep-sweep.py` and confirm it reports clean.
