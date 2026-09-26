# Hosted service operations

The Worker changes in this branch are implemented locally. Deployment, real
Stripe lifecycle verification, and enabling purchases are separate release steps.
Customer portal and duplicate-subscription prevention remain billing-management
work. Keep `CHECKOUT_ENABLED=false` until those changes and the checks below pass.

## Environment record

Maintain a private record for each environment with the Worker URL/name, D1
database name/ID, GitHub OAuth app and callback URL, Stripe mode, price ID, webhook
endpoint ID/API version, deployed commit, and verification date. Record secret
locations, not their values. Keep preview and production databases, OAuth apps,
customers, prices, API keys, and signing secrets separate.

| Binding | Purpose |
| --- | --- |
| `DB` | Environment-specific D1 database. |
| `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | OAuth app with callback `https://WORKER/oauth/github/callback`. |
| `COOKIE_SECRET` | Distinct random signing secret for this environment. |
| `STRIPE_MODE` | Exactly `test` or `live`; checked against API key, signed event, and retrieved subscription. |
| `STRIPE_SECRET_KEY` | Matching Stripe secret API key. Required for every subscription refresh. |
| `STRIPE_SUPPORTER_PRICE_ID` | Active USD 1 monthly recurring, licensed, per-unit price in this mode. |
| `STRIPE_WEBHOOK_SECRET` | Signing secret belonging to this endpoint. |
| `STRIPE_WEBHOOK_PREVIOUS_SECRET` | Optional previous secret during rotation; remove after the overlap period. |
| `CHECKOUT_ENABLED` | Only the literal `true` enables purchases; defaults to disabled. |
| `BILLING_SUPPORT_EMAIL` | Maintainer-approved public support email, shown on account, upgrade, and `/support` pages. |
| `BILLING_REFUND_POLICY` | Maintainer-approved plain-text refund policy, shown alongside the contact. |
| `REPORT_RATE_SCOPE` | Stable Worker/environment identifier, never a caller-supplied hostname. |
| `REPORT_TOKEN_LIMITER`, `REPORT_ACCOUNT_LIMITER` | Upload rate-limit bindings. |

Checkout also requires complete support and billing configuration. Disabling it
does not clear Stripe price configuration, remove existing entitlements, or pause
webhooks. The endpoint validates the configured price before creating a purchase.

The webhook endpoint must use `2026-04-22.dahlia` and receive
`checkout.session.completed`, `customer.subscription.created`,
`customer.subscription.updated`, `customer.subscription.deleted`, and
`invoice.paid`. Signed events with a different mode or API version are rejected
before recording or updating billing facts.

## Stable isolated preview

Generic PR previews use test mode and disabled checkout, but do not provision
OAuth or Stripe resources. Do not use a temporary PR deployment for payment
lifecycle verification. Use a dedicated, stable preview Worker and database.

Commands below run from `recoverage.cloud`. Provision a dedicated D1 database
with `bun run wrangler d1 create recoverage-billing-preview-data`, then use its
returned ID:

```sh
WORKER_NAME=recoverage-billing-preview \
DATABASE_NAME=recoverage-billing-preview-data \
DATABASE_ID=YOUR_PREVIEW_DATABASE_ID \
bun run billing:preview:config
```

The generator refuses the production Worker name or database and writes ignored
`wrangler-billing-preview.jsonc` with checkout off. Its rate scope is separate
from production. Keep the configured limiter namespace IDs unique within the
Cloudflare account; environments sharing them remain separated by their scope.

Create a separate GitHub OAuth app with the stable preview callback. Create a
Stripe test monthly price and webhook endpoint at the stable Worker URL. Set
each secret using `bun run wrangler secret put NAME --config
wrangler-billing-preview.jsonc`. Use the binding table above; never reuse live
Stripe or production OAuth secrets. Set the public support email and refund
policy as secrets or deployment configuration too, so each environment has its
own explicit values.

After reviewing the generated configuration, build assets, apply the generated
migrations to the preview database, and deploy:

```sh
bun run setup:deps
bun run gen:scripts
bun run wrangler d1 migrations apply recoverage-billing-preview-data --remote --config wrangler-billing-preview.jsonc
bun run wrangler deploy --config wrangler-billing-preview.jsonc
```

Use an ignored local `.env.billing-preview` or a secret manager for verification.
In addition to the billing/OAuth/support bindings, the verifier needs
`BILLING_WORKER_URL` (HTTPS origin) and `STRIPE_WEBHOOK_ENDPOINT_ID`:

```sh
bun --env-file=.env.billing-preview __scripts__/verify-billing-env.bun.ts
```

This is a read-only Stripe configuration check. It verifies price, endpoint URL,
mode, API version, status, and subscribed events. It cannot prove that locally
supplied secrets equal deployed secrets or that a signing secret belongs to the
endpoint; a real signed delivery is required. Verify the OAuth callback by
signing in and confirm the deployed D1 binding against the environment record.

For the hosted storage check, create a disposable preview project/token and add
`PREVIEW_REPORTER_TOKEN` to the ignored preview environment file:

```sh
bun --env-file=.env.billing-preview __scripts__/verify-report-storage.bun.ts
```

The probe creates a tiny baseline and attempts a bounded 2.1 MB replacement. It
requires the storage-specific `413` and verifies the original is still readable.
Delete the disposable project afterward. The local D1 emulator does not enforce
the hosted 2,000,000-byte limit, so passing local mocks is insufficient evidence
of this hosted behavior. Unexpected error shapes remain `500` until confirmed;
inspect them only in the isolated preview without logging report contents.

## Upload behavior and troubleshooting

| Response/code | Meaning and action |
| --- | --- |
| `401 UNAUTHORIZED` | Check the reporter token and owning project. Do not buy another plan to fix credentials. |
| `400 INVALID_REPORT` | Fix the ref or coverage payload. |
| `403 REPORT_QUOTA_EXCEEDED` | Account slots are exhausted. Existing refs can still be replaced. Remove unused projects/reports or choose a plan with more slots. |
| `429 RATE_LIMITED` | Pause for the `Retry-After` interval (currently 60 seconds) and retry the CI job. |
| `413 REQUEST_TOO_LARGE` | The streaming ingress guard rejected the upload. Reduce coverage scope or split reports. |
| `413 REPORT_TOO_LARGE` | D1 rejected the stored row size. Reduce coverage scope or split reports; upgrading does not help. |
| `500 INTERNAL_ERROR` | An unexpected service/database failure; retry later and investigate service logs. |

The CLI reports the HTTP status/body and exits unsuccessfully when an upload
fails. It does not automatically retry; this avoids an unbounded retry storm.
If adding retries later, bound attempts and honor `Retry-After`.

Report quotas are enforced in the same SQL statement as insertion. Replacements
remain allowed above quota, including after downgrade. The report-count exemption
does not exempt an account from rate limits or storage constraints.

Uploads use verified token and owner IDs with budgets of 120/minute/token and
600/minute/account. Downloads, badges, and webhooks do not consume upload budgets.
These are operational settings in Wrangler, not paid entitlements. Cloudflare's
binding is approximate and local to a location; it is not a strict global meter.
See [Workers rate limits](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/).

The shared ingress guard stops after 4,000,000 streamed bytes, even without a
trustworthy Content-Length. This bounds request buffers before JSON parsing and
allows framing/escaping headroom; it does not promise that an upload fits storage.
D1's 2,000,000-byte constraint applies to the stored row including coverage,
summary, and metadata. See [D1 limits](https://developers.cloudflare.com/d1/platform/limits/).
The error mapper inspects D1 errors and their causes, following the
[Worker binding's error wrapper](https://github.com/cloudflare/workerd/blob/main/src/cloudflare/internal/d1-api.ts).
It does not interpret arbitrary SQL parameters or unrelated errors as a size failure.

## Billing incident procedures

Use the Stripe dashboard's matching test/live environment and the corresponding
D1 database. Query only selected metadata columns; do not dump event payloads,
report bodies, tokens, or customer details into terminal/CI logs.

### Payment succeeded but the account is Free

1. Verify the user's numeric GitHub ID. Look up its customer and subscriptions
   using `stripeCustomers.userId` and `stripeSubscriptions.userId`.
2. Check the configured price ID, subscription status, current period end, latest
   invoice ID/payment timestamp, and any `users.manualRoleOverride`. Paid access
   requires the matching price, active status, a paid latest invoice, and an
   unexpired period. There is no trial/past-due grace policy.
3. Inspect the Stripe subscription and latest invoice directly. Find the relevant
   delivery in Stripe and check the local event ID's `processedAt` and
   `processingError`. A missing API key or failed lookup leaves it retryable.
4. Correct configuration and resend a failed/unprocessed event to this endpoint
   in the Stripe dashboard or with `stripe events resend EVENT_ID
   --webhook-endpoint=ENDPOINT_ID` in the correct Stripe environment.
5. Verify the local facts and account page after processing. Do not ask the user
   to purchase again. An already processed event is deduplicated; if explicit
   reconciliation is needed, use Stripe to generate a fresh subscription update
   or, after recording the operator/reason/event ID, clear only that known event's
   `processedAt` and resend it. Every sync retrieves current Stripe facts.

Useful metadata-only queries (replace identifiers with verified values):

```sql
SELECT stripeCustomerId FROM stripeCustomers WHERE userId = 123;
SELECT stripeSubscriptionId, priceId, status, currentPeriodEnd,
       latestInvoiceId, latestInvoicePaidAt, cancelAtPeriodEnd
FROM stripeSubscriptions WHERE userId = 123;
SELECT stripeEventId, type, mode, receivedAt, processedAt, processingError
FROM stripeWebhookEvents WHERE processedAt IS NULL ORDER BY receivedAt;
```

### Failed webhook delivery

Inspect the compact `stripe_webhook` log (event ID, type, outcome, duration) and
the matching Stripe request/delivery log. Stored errors intentionally omit raw
API responses and query parameters. Check mode/version, signing secret, API key,
price/customer ownership, expanded invoice, and D1 availability. Correct the cause,
resend, then confirm `processedAt` is set and `processingError` clears. Repeating
a completed delivery must return `duplicate: true` without changing facts.

### Signing-secret rotation

Use Stripe's endpoint-secret overlap window. Before rotating, copy the existing
secret into `STRIPE_WEBHOOK_PREVIOUS_SECRET` in the same Worker environment.
Rotate in Stripe, set the new `STRIPE_WEBHOOK_SECRET`, and verify successful signed
deliveries. Keep the previous secret only through the chosen overlap period;
remove it with `wrangler secret delete STRIPE_WEBHOOK_PREVIOUS_SECRET` using the
same config. Never remove the active secret to pause checkout.

### Manual entitlement

Verify the numeric GitHub user ID, record the operator, reason, desired role, and
review/expiry date in the private support record, then update only that user:

```sql
UPDATE users SET manualRoleOverride = 'supporter' WHERE id = 123;
-- Clear the override to resume billing-derived access:
UPDATE users SET manualRoleOverride = NULL WHERE id = 123;
```

Valid values are `free`, `supporter`, `admin`, or NULL. A manual Free override
also wins over a paid subscription. Confirm the account's effective role after
every change. The separate maintainer report-count exemption does not change its
project/token limits.

### Cancellation or refund

Use Stripe's supported subscription/refund controls until billing management is
implemented. Scheduled cancellation retains access while the current paid period
remains active; effective cancellation removes paid access. Refunds do not by
themselves define a cancellation or entitlement policy. Follow the maintainer's
published `BILLING_REFUND_POLICY`, record the decision, and verify the resulting
subscription and effective role. Never promise a refund policy not approved by
the maintainer.

### Pause new purchases

Set `CHECKOUT_ENABLED=false` and deploy the same code/config to the affected
environment. Verify `/billing/checkout` returns `503` and the upgrade page has no
purchase form. Leave all Stripe credentials, price ID, webhooks, uploads, reads,
and existing subscriber access configured. Fix the incident and repeat billing
verification before considering re-enablement.

## Logs, retention, and monitoring

Request logs contain route category, method, status, and elapsed time. Webhook
logs add event ID/type and outcome. Database query/parameter logging and OAuth
access-token/report-body logging are disabled. Keep secret values and payloads
out of support tickets and command output too.

The daily 03:00 UTC job replaces processed event payloads older than 30 days and
unprocessed payloads older than 90 days with `{}`. Event IDs, timestamps, mode,
type, and outcome remain for deduplication and diagnosis; a retry brings its own
signed body. Logs report the redacted count. Compact records still grow, so
monitor their count and D1 size; do not imply report quotas bound billing storage.

In Cloudflare Workers observability, watch upload `413`/`429`/`5xx`, CPU/memory
failures, and `stripe_webhook` failed outcomes. In Stripe, enable webhook-delivery
failure notifications for the endpoint. In D1 metrics, watch storage, write
errors/latency, and capacity headroom. Review the oldest unprocessed event daily
and verify daily retention executions. Configure alerts in the chosen account
before launch; this repository does not create account notification destinations.

Suggested initial alerts: any webhook failure persisting for 15 minutes, upload
5xx above 1% for 10 minutes, no successful retention execution for 48 hours, or D1
storage above 80% of its current capacity. Tune with observed traffic; investigate
throttling before increasing budgets and repeat the 100-report burst test after
rate changes.

## Migration and rollback

Run `bun run test:migrations` for the disposable SQLite rehearsal and the cloud
suite for generated migrations in the Worker runtime. Before deployment, export
a representative existing D1 database to a private location, import into a
disposable preview database, apply migrations, and compare users, project/token
ownership, report counts, and representative report contents. Do not commit or
log the export.

Migration `0004` drops `users.role` and adds `manualRoleOverride`. The ordinary
Free role maps to NULL; preserve any manually assigned exceptions in a private
record and restore the appropriate explicit overrides after migration. Existing
migrations must not be edited. Generate any further schema changes with
drizzle-kit.

Prepare rollback by retaining a known-good Worker version built against the new
schema, with checkout off, and test it against the migrated disposable database.
The branch before launch-readiness changes is schema-compatible, but needs the
checkout pause behavior carried into a rollback build. Do not roll back directly
to main's old Worker, which queries `users.role`. If database restoration is ever
necessary, first pause writes, assess writes since the backup, and plan their
recovery; do not blindly restore an old snapshot over new reports/payments.

## Release evidence

Record results and resource IDs in the environment record. Local validation is
not evidence that a real payment or production deployment occurred.

- Local build, lint, formatting, migration rehearsal, and cloud tests pass,
  including concurrent report inserts, 100-report bursts, downgrade replacements,
  throttle/size failures, signed webhook ordering, rotation, and mode isolation.
- Isolated preview has verified OAuth, D1 binding, Stripe price/endpoint/version,
  signed delivery, hosted-size rejection, and preserved replacement data.
- After billing management is implemented: exercise signup, purchase, renewal,
  failed payment, card update, cancellation, downgrade, duplicate and reordered
  deliveries, and recovery after an unsuccessful lookup in Stripe test mode.
- Support email and refund policy are approved and visible; operating procedures,
  failure notifications, capacity monitoring, and schema-compatible rollback have
  been rehearsed.
- Deploy live with checkout off, verify live-mode resources and signed delivery,
  then explicitly enable checkout only after the complete launch gate passes.
