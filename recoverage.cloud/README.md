# recoverage.cloud

`recoverage.cloud` is the hosted companion service for the `recoverage` CLI. It
stores coverage reports between CI runs so feature branches can diff against the
latest report from a repository's default branch.

The app is a Cloudflare Worker built with Hono, backed by Cloudflare D1, and
deployed with Wrangler. It provides:

- a GitHub OAuth UI for managing projects and reporter tokens;
- authenticated reporter endpoints used by the `recoverage` package;
- badge/shield endpoints for published coverage summaries.

## Development

From the repository root:

```sh
bun install
bun run build
bun run --filter=recoverage.cloud gen
bun run --filter=recoverage.cloud dev
```

Useful scripts:

- `bun run --filter=recoverage.cloud test` - run the app tests once.
- `bun run --filter=recoverage.cloud check` - run Biome, ESLint, and type checks.
- `bun run --filter=recoverage.cloud db:gen` - generate Drizzle migrations.
- `bun run --filter=recoverage.cloud db:up` - apply D1 migrations.

## Configuration

The Worker expects these bindings/secrets:

- `DB` - Cloudflare D1 database binding.
- `GITHUB_CLIENT_ID` - GitHub OAuth app client ID.
- `GITHUB_CLIENT_SECRET` - GitHub OAuth app client secret.
- `COOKIE_SECRET` - secret used to sign auth cookies.

Production deploys use `wrangler.jsonc`; preview deploys use
`wrangler-preview.jsonc` and the `preview:*` scripts.

## CLI management API

The CLI calls these routes through Hono's RPC client. JSON validators define
request types, and handler results define response types. Run
`bun run --cwd recoverage.cloud gen:api` after changing routes and commit the
generated `packages/recoverage/src/cloud-api.gen.d.ts` with the change.
`bun run check:api` detects a stale contract. The generated declaration excludes
Worker bindings so the published CLI needs only Hono's client runtime. The web
UI continues to use HTMX and the shared project/token operations.

The `/api/v1` JSON API supports CLI login, project management, and report management. Before deploying
this milestone, enable **Device Flow** in the existing GitHub OAuth app's settings
([GitHub documentation](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps#device-flow)).
It uses the existing `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET`; no new secret or
callback URL is needed. Apply the generated `0004` migration before deploying the
Worker (`bun run --filter=recoverage.cloud db:up --remote`).

- `POST /api/v1/auth/device` starts GitHub device authorization.
- `POST /api/v1/auth/session` exchanges an approved `deviceCode` for a Recoverage
  account credential. Pending approvals and polling slowdowns return HTTP 202.
- `DELETE /api/v1/auth/session` revokes the current account credential.
- `GET /api/v1/account` returns identity, session expiry, role, and quotas (`null`
  means unlimited).
- `GET /api/v1/projects` returns owned projects, report metadata, and token metadata.
- `POST /api/v1/projects` creates a project from `{ "name": "..." }`.
- `GET /api/v1/projects/:projectId` returns project metadata.
- `PATCH /api/v1/projects/:projectId` renames a project from `{ "name": "..." }`.
- `DELETE /api/v1/projects/:projectId` deletes the project and cascades its reports
  and reporter tokens.
- `GET /api/v1/projects/:projectId/tokens` lists token metadata without secrets.
- `GET /api/v1/projects/:projectId/reports` lists report refs, creation times, and
  decoded coverage summaries, without coverage maps.
- `GET /api/v1/projects/:projectId/reports/:reportRef` returns the same metadata
  for one report.
- `GET /api/v1/projects/:projectId/reports/:reportRef/data` returns `{ ref, mapData }`.
- `PUT /api/v1/projects/:projectId/reports/:reportRef` validates and stores
  `{ mapData, jsonSummary }`, sharing storage and validation with reporter uploads.
- `DELETE /api/v1/projects/:projectId/reports/:reportRef` deletes a report.
- `GET /api/v1/projects/:projectId/reports/:reportRef/badge` returns public
  Shields.io endpoint/image URLs and Markdown. Missing summaries return HTTP 409.
- `POST /api/v1/projects/:projectId/tokens` creates a reporter token from
  `{ "name": "..." }` and returns its secret once.
- `DELETE /api/v1/projects/:projectId/tokens/:tokenId` revokes a reporter token.

Management endpoints require `Authorization: Bearer rca_ID.SECRET`. Account
credentials expire after 30 days and are stored as salted hashes; GitHub access
tokens used for device login are not persisted. Reporter credentials cannot
access management endpoints, and account credentials cannot access reporter
endpoints. API responses use `Cache-Control: no-store`; project listings exclude
credential hashes, salts, and secrets. SQL parameter logging is disabled to keep
credential material out of Worker logs.

Project/token operations are shared with the browser UI. Quota checks and inserts
are atomic to enforce limits across concurrent clients. Resource lookups verify
the authenticated owner's ID. The new API does not alter the browser's existing
GitHub OAuth flow or reporter endpoint URLs.

## Report quota exemptions

Free accounts are limited to three reports per project. The explicit
`unlimitedReportGithubUserIds` allowlist in `src/roles-permissions.ts` exempts
selected accounts from this report quota, starting with `jeremybanka` (`8570459`).
To add an account, verify its numeric ID with `gh api users/LOGIN --jq .id`, then
add the ID with a comment identifying the account. Deploy the Worker to apply
allowlist changes; no database migration or CLI release is needed.

The exemption uses the project owner's GitHub ID stored during OAuth, after
verifying the reporter token. Authentication, project ownership, report ref and
payload validation, and project/token limits still apply. Replacing an existing report does not consume a quota slot, including when the
project is full. Report creation checks and writes are atomic. Report refs must
contain 1–64 characters with no slashes or control characters and cannot be `.` or
`..`; encode refs as URL path components. Maps and summaries retain their existing
report creation timestamp when replaced. Reports are retained until the report or
its project is deleted; there is no automatic retention limit.
