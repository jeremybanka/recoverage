# Repository commands

Run these commands from the repository root with `bun run <command>`. `mise.toml` selects the toolchain. Package-level commands keep the same meaning while narrowing their scope.

Following the [mise Node.js cookbook](https://mise.jdx.dev/mise-cookbook/nodejs.html#add-node-modules-binaries-to-the-path), mise adds the repository root’s `node_modules/.bin` to `PATH`. With shell activation or `mise exec -- <tool>`, installed dependency CLIs are available from the root and package directories.

| Command | Contract |
| --- | --- |
| `fmt` | Apply the repository formatting policy. |
| `check:fmt` | Validate formatting without rewriting maintained files; language-specific validators are listed below. |
| `check` | Run every static check listed below. Generated prerequisites and caches may be written; source fixes are explicit. |
| `test` | Run the normal test suite once and return a failing status when tests fail. |
| `test:watch` | Watch the available interactive test suites. |
| `cov` | Run tests with coverage, including the CLI's Bun subprocesses. |
| `cov:check [ref]` | Generate coverage and compare each package with an exact Git revision (default: local `origin/main`). |
| `build` | Build distributable artifacts. |
| `change` | Author pending release notes. |
| `release:version` | Prepare versions and release metadata without publishing. |
| `release:publish` | Build as required by the release pipeline and publish packages. |
| `workflows:update` | Update pinned workflow tooling references. |

## Static checks

- `check:biome`: `turbo run check:biome`.
- `check:deps`: `pin-checker --ignore-workspaces`.
- `check:eslint`: `turbo run check:eslint`.
- `check:fmt`: `dprint check`.
- `check:tsc`: `turbo run check:tsc`.

## Command notes

The Recoverage CI job generates coverage on pushes to `main` and `paid-coverage-tiers`. On pull requests it also generates a fresh baseline from the PR's exact target commit and uses the freshly built recoverage CLI to reject a decrease in either package's statement coverage. The comparison uses disposable local SQLite databases; forks need no reporter token, and the first run needs no pre-existing baseline. Missing or empty reports fail the job. This repository has no release-compatibility suite.

`bun run cov` writes `coverage/coverage-final.json` and `coverage/coverage-summary.json` in each package. The CLI suite instruments a disposable source copy before tests and bundling, so Node tests and Bun subprocesses share the same statement counters. Untested source files remain in the denominator. The temporary instrumented build omits declarations; the ordinary build still validates and emits those. The cloud suite uses Istanbul because the Workers runtime does not support V8 coverage. Generated source and declaration files are excluded.

`bun run cov:check origin/main` installs the selected revision's locked dependencies in a temporary directory, runs that revision's tests with the current coverage harness, normalizes source paths, and compares the reports. Baseline collection deliberately works for revisions predating these commands. The ref must already exist locally; fetch it first if necessary. Package-level commands narrow the comparison to that package. Root `cov` builds prerequisites; build the CLI first when invoking package commands directly.

Coverage and comparisons run uncached. Coverage tasks preserve the caller’s toolchain and certificate environment for subprocess installs, while the harness clears hosted report credentials. Neither command publishes hosted baselines. Using the PR target commit rather than a moving branch or latest artifact keeps the baseline reproducible; tests and dependency installation run twice for a PR. Coverage collection and comparison failures propagate as job failures.

## Migration

`fmt` now applies formatting; use `check:fmt` for the former validation behavior. Package `test` now runs once; use `test:watch` for interactive watching. Use the canonical commands directly; superseded names have been removed.
