# Repository commands

Run these commands from the repository root with `bun run <command>`. `mise.toml` selects the toolchain. Package-level commands keep the same meaning while narrowing their scope.

| Command | Contract |
| --- | --- |
| `fmt` | Apply the repository formatting policy. |
| `check:fmt` | Validate formatting without rewriting maintained files; language-specific validators are listed below. |
| `check` | Run every static check listed below. Generated prerequisites and caches may be written; source fixes are explicit. |
| `test` | Run the normal test suite once and return a failing status when tests fail. |
| `test:watch` | Watch the available interactive test suites. |
| `build` | Build distributable artifacts. |
| `verify` | Run the repository checks, tests, builds, and implemented coverage or compatibility gates. |
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

## Verification

`bun run verify` executes `bun run check && bun run test && bun run build`. CI can run these constituent commands in separate jobs. Check failures must propagate to the caller.

This repository has no implemented coverage-regression or release-compatibility suite. The former empty CI jobs and task entry points have been removed; `verify` covers the implemented checks, tests, and build.

## Migration

`fmt` now applies formatting; use `check:fmt` for the former validation behavior. Package `test` now runs once; use `test:watch` for interactive watching. Use the canonical commands directly; superseded names have been removed.
