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
bun run --filter=recoverage.cloud gen
bun run --filter=recoverage.cloud dev
```

Useful scripts:

- `bun run --filter=recoverage.cloud test:once` - run the app tests once.
- `bun run --filter=recoverage.cloud lint` - run Biome, ESLint, and type checks.
- `bun run --filter=recoverage.cloud db:gen` - generate Drizzle migrations.
- `bun run --filter=recoverage.cloud db:up` - apply D1 migrations.

## Configuration

The Worker expects these bindings/secrets:

- `DB` - Cloudflare D1 database binding.
- `GITHUB_CLIENT_ID` - GitHub OAuth app client ID.
- `GITHUB_CLIENT_SECRET` - GitHub OAuth app client secret.
- `COOKIE_SECRET` - secret used to sign auth cookies.

Billing additionally requires `STRIPE_SECRET_KEY`, `STRIPE_SUPPORTER_PRICE_ID`,
and `STRIPE_WEBHOOK_SECRET`. Every relevant webhook refreshes the subscription
and its expanded latest invoice through the Stripe API. If the API key is missing
or the lookup fails, the event remains unprocessed and returns a server error so
Stripe can retry; it does not overwrite subscription facts from an event snapshot.

Production deploys use `wrangler.jsonc`; preview deploys use
`wrangler-preview.jsonc` and the `preview:*` scripts.

## Hosted plans

The paid-tier branch offers Free (3 hosted reports), Supporter ($1/month for
100 hosted reports), and an internal Admin role (200 hosted reports). Reports
are counted across all projects owned by a GitHub account. Updating an existing
report does not consume another slot, including when the account is at its limit.

All plans use the same D1 storage constraints. Cloudflare currently limits a
string, BLOB, or entire row to 2,000,000 bytes; a report row also contains its
summary and metadata, so this is not a promised upload size. There are no
plan-specific report byte allowances. See [D1 limits](https://developers.cloudflare.com/d1/platform/limits/),
the [paid service plan](PAID_SERVICE_PROPOSAL.md), and the
[launch status](LAUNCH_READINESS_PROPOSAL.md).

## Report quota exemptions

Free accounts are limited to three reports per account. The explicit
`unlimitedReportGithubUserIds` allowlist in `src/roles-permissions.ts` exempts
selected accounts from this report quota, starting with `jeremybanka` (`8570459`).
To add an account, verify its numeric ID with `gh api users/LOGIN --jq .id`, then
add the ID with a comment identifying the account. Deploy the Worker to apply
allowlist changes; no database migration or CLI release is needed.

The exemption uses the project owner's GitHub ID stored during OAuth, after
verifying the reporter token. Authentication, project ownership, report ref and
payload validation, project/token limits, and D1 storage constraints still apply.
The exemption removes the report-count bound for these selected accounts.
Reports are retained
until their project is deleted; there is no separate storage quota or automatic
retention limit in the app.

## Usage, errors, and operations

The account page shows combined hosted-report and project usage. Each project
shows token usage, and creation controls explain exhausted limits. Existing
reports and credentials remain usable after a downgrade. `/support` publishes the
maintainer-configured billing contact and refund policy; see the service's
[current support page](https://recoverage.cloud/support) after deployment.

Uploads return distinct codes for invalid credentials (401), invalid coverage
(400), exhausted report slots (403), request frequency (429, with Retry-After),
and ingress/storage size rejection (413). The shared streaming ingress guard is
an operational protection, independent of plan roles. Uploads are limited to
120/minute/token and 600/minute/account per Cloudflare location. The CLI surfaces
errors without automatic retries. Reads and badges do not use upload budgets.

New checkout defaults off. Configure `STRIPE_MODE`, the matching Stripe secrets,
`BILLING_SUPPORT_EMAIL`, and `BILLING_REFUND_POLICY`; enable `CHECKOUT_ENABLED`
only after the launch gates pass. Preview and live events are kept separate.
The daily retention job redacts old event payloads while preserving deduplication
metadata. No report or raw payment payload is written to application logs.

See [OPERATIONS.md](OPERATIONS.md) for stable preview setup, configuration and
hosted-storage verification scripts, webhook recovery, signing-secret rotation,
entitlement overrides, retention, monitoring, migration rehearsal, and rollback.
Customer portal and duplicate-subscription prevention remain the next phase.
