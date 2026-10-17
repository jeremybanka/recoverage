# recoverage.cloud

`recoverage.cloud` is the hosted companion service for the `recoverage` CLI. It
stores coverage reports between CI runs so feature branches can diff against the
latest report from a repository's default branch.

The app is a Cloudflare Worker built with Hono, backed by Cloudflare D1, and
deployed with Wrangler. It provides:

- a GitHub OAuth UI for managing projects and reporter tokens;
- authenticated reporter endpoints and opt-in public report downloads used by the `recoverage` package;
- badge/shield endpoints for published coverage summaries.

## Public reports

Projects start with private reports. Owners can enable **Public reports** in the
project's Reports section to allow unauthenticated reads of all reports in that
project. The UI displays `RECOVERAGE_CLOUD_PROJECT_ID` for use with the CLI.

Public reads use `GET /reporter/public/:projectId/:reportRef`; private or missing
reports return 404. Responses use `Cache-Control: no-store` so new requests
recheck visibility. Turning public access off stops future public downloads,
but cannot remove reports someone has already downloaded or cached locally.
Uploads still require a project-scoped reporter token. Existing authenticated
reads and published summary badges keep their existing behavior.

## Development

From the repository root:

```sh
bun install
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

## Report quota exemptions

Free accounts are limited to three reports per project. The explicit
`unlimitedReportGithubUserIds` allowlist in `src/roles-permissions.ts` exempts
selected accounts from this report quota, starting with `jeremybanka` (`8570459`).
To add an account, verify its numeric ID with `gh api users/LOGIN --jq .id`, then
add the ID with a comment identifying the account. Deploy the Worker to apply
allowlist changes; no database migration or CLI release is needed.

The exemption uses the project owner's GitHub ID stored during OAuth, after
verifying the reporter token. Authentication, project ownership, report ref and
payload validation, and project/token limits still apply. Reports are retained
until their project is deleted; there is no separate storage quota or automatic
retention limit in the app.
