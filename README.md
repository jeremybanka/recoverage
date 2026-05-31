# recoverage

This repository is the monorepo for `recoverage`, a command-line tool for
tracking coverage changes over time and guarding against coverage regressions in
CI.

If you are looking for installation, usage, or package API details, start with
the actual package:

**[packages/recoverage](./packages/recoverage)**

## What's Here

- `packages/recoverage` - the published `recoverage` npm package and CLI.
- `packages/fixtures` - local fixtures used by the package tests.
- `recoverage.cloud` - the hosted service used for persisting coverage reports
  between CI runs.
- `scripts` - repository maintenance scripts.

This root exists mainly for workspace and repository-level tooling. The package
README is the source of truth for using `recoverage`.
