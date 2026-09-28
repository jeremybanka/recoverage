# Release compatibility

`bun run test:semver` checks consumer behavior against released public tests. Current tests must pass before release tests are restored. The gate requires an executable historical contract; fixture files alone do not qualify. A documented intentional break needs the version bump described in [repository commands](commands.md).

## Protected behavior

The public suite uses an npm package archive and invokes its declared CLI or imports `recoverage` and `recoverage/lib` from an isolated consumer project. Assertions are limited to these behaviors:

| Surface | Contract exercised |
| --- | --- |
| Coverage API | `capture` accepts a selected branch and `silent`; `diff` accepts a selected branch. Unchanged/increased coverage succeeds, decreased coverage fails, and missing baseline data fails. |
| CLI | `capture`, `diff`, and the combined command accept the documented branch aliases. The default branch is `main`; configuration applies to coverage commands and CLI options take precedence. Invalid configuration fails before saving coverage. Unknown-option warnings remain advisory. |
| Help and completion | Help is available without Git or coverage. Completion generation for the five documented shells works without Git, coverage, or valid application configuration. |
| Library reports | Consumer-owned Istanbul coverage maps produce the corresponding statement counts/percentage and a text report. |
| Cloud library results | Successful downloads return response content; successful uploads report success; unsuccessful HTTP responses return an `Error`. |
| TypeScript | Normal consumer calls and result assignments compile through both package entrypoints with the fixture's pinned compiler. Added options or result properties remain compatible. |
| Saved coverage | The current package can compare improved and decreased coverage against baseline data created by the published `recoverage@0.1.18` capture API. |

Human-readable report layout, log text, error wording, completion ordering/protocol bytes, generated integration source, private HTTP routing/serialization, dependency installation layout, database tables, schema, and file bytes are not asserted. Shell installation and branch-suggestion details still have ordinary tests but are not historical contracts in this suite. The suite is a selected set of protections, not an exhaustive inventory of every exported symbol or documented behavior.

## Fixture provenance and replay

`packages/recoverage/__tests__/public/consumer` is a private workspace with its own pinned Istanbul dependency and TypeScript compiler. It supplies these directly to consumers instead of importing dependencies from inside Recoverage. Runtime fixtures unpack the current npm archive, follow its declared executable, and resolve its declared dependencies normally.

The `recoverage-0-1-18` dependency points directly at the published npm `0.1.18` tarball, with package integrity recorded in `bun.lock`. An npm version alias can resolve to a same-version workspace in Bun, so the fixture uses the explicit tarball URL and rejects a producer whose real path is the current package. Renovate leaves that producer fixed. Tests copy it into the isolated consumer repository, run its public `capture`, then use the current package's public `capture` and `diff` against the saved data. The fixture ignores generated files and observes results through public APIs; it never reads database tables or seeds a handcrafted schema. Add another versioned producer dependency for another released format instead of replacing this one. Keep producers and fixture dependencies needed by historical tests available during replay.

Public tests, their helper code, and the consumer fixture are restored together by break-check. At the current `recoverage@0.1.18` baseline, only the original installed-package coverage improvement/regression tests are historical contracts. The expanded suite runs as current preflight protection now and becomes historical protection after its first release; it does not retroactively add tests to that older tag.
