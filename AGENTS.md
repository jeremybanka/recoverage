# AGENTS

General guidance for working in this repository:

- Pin dependencies as exactly as possible. Do not use version ranges like `^`, `~`, `>`, or `*`.
- Database migrations are managed by `drizzle-kit`. Do not hand-edit existing migrations, and only hand-edit a newly generated migration when you have explicit permission.
- Releases for the `recoverage` npm package are managed with Changesets. When adding release notes, follow the style of the patch notes in packages/recoverage/CHANGELOG.md.
- `recoverage` is pre-version-1, so breaking changes should be given a minor version bump, but noted as `💥 BREAKING CHANGE:` in the release notes.
