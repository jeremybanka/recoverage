# Paid hosted coverage reports

Updated September 22, 2026. This is the product plan for `paid-coverage-tiers`;
implemented behavior and remaining work are distinguished below. Launch work is
proposed separately in [LAUNCH_READINESS_PROPOSAL.md](LAUNCH_READINESS_PROPOSAL.md).

## Product

Keep the hosted service useful for small projects and offer one public paid plan:
Supporter at $1/month. Payment buys more hosted reports and supports the service.
The CLI, upload/download API, and public badges remain the same across plans.

A report is the latest coverage baseline for one `(projectId, reportRef)` pair.
Replacing that baseline does not create another report. This is not a report
history or archival product.

| Plan | Price | Hosted reports per account | Projects | Tokens per project |
| --- | --- | ---: | ---: | ---: |
| Free | $0 | 3 | 3 | 5 |
| Supporter | $1/month | 100 | 100 | 10 |
| Admin | Internal manual override | 200 | 200 | 25 |

Hosted reports are counted across every project owned by the GitHub user. Projects
remain grouping and credential boundaries; an account can distribute its reports
across repositories or keep them together in a monorepo. Project and token limits
are supporting guardrails.

## Storage constraint

Keep report bodies and summaries in D1. All roles share Cloudflare's storage
constraints; upgrading does not increase the size of an individual report.

Cloudflare currently documents a maximum of 2,000,000 bytes for a string, BLOB,
or complete table row. The report's coverage JSON, summary, identifiers, timestamp,
and row overhead must fit together. This is not a guaranteed 2 MB upload allowance.
D1 remains the authority on whether a stored row fits. See the
[official D1 limits](https://developers.cloudflare.com/d1/platform/limits/).

Remove the former size entitlements from the permission model, pricing UI, and
upload checks. Do not replace them with role-dependent byte constants or promise
larger reports for Supporter or Admin. Report count combined with the shared row
constraint bounds each ordinary account's report storage, although database-wide
capacity, token/project metadata, webhook records, and request volume still need
operational monitoring.

The maintainer's explicit report-count exemption remains. It does not exempt
uploads from D1 constraints and means the ordinary per-account count bound does
not apply to that account.

Object storage is outside the current plan. Revisit it only if supporting larger
individual reports becomes a deliberate product requirement. Better handling of
D1 size errors and ingress/resource protection are proposed launch work; removing
size entitlements does not itself implement that handling.

## Entitlements and billing

Billing belongs to a GitHub user. The implementation stores:

- `users.manualRoleOverride`, rather than a persisted billing-derived role;
- the user's Stripe customer in `stripeCustomers`;
- price, status, billing period, invoice facts, and cancellation state in
  `stripeSubscriptions`;
- signed event payloads, processing status, and errors in `stripeWebhookEvents`.

A manual role override wins. Otherwise the user receives Supporter only when a
subscription matches the configured Supporter price, is active, has a recorded
paid invoice, and has a period end later than the time of the request. Every other
case receives Free. The current policy does not grant trial or past-due grace
entitlements. A scheduled cancellation retains access while these conditions
still hold; an effective cancellation or expired period removes paid access.

On downgrade, existing reports remain readable and replaceable. Creating another
report is blocked when the account is already at or above its new quota. Existing
projects and tokens are not automatically deleted either.

Stripe Checkout handles subscription purchases. Signed webhooks synchronize local
billing facts. Processed event IDs are recorded to avoid reapplying a completed
event; unsuccessful processing is retained for retries and diagnosis. Lifecycle
tests must establish renewal, cancellation, duplicate-delivery, retry, and ordering
behavior before relying on this for paid users. Stripe does not guarantee event
ordering; see its [webhook guidance](https://docs.stripe.com/webhooks#event-ordering).

## Current implementation

- Account-wide quotas and replacement of existing report refs at the quota.
- Free, Supporter, and Admin project/token/report permissions.
- Manual role overrides and the maintainer's report-count exemption.
- Stripe customer/subscription/event tables and generated migration.
- `POST /billing/checkout` and `POST /billing/webhook`.
- Subscription and invoice event handling, with backfill for missing subscriptions.
- Authenticated `/ui/upgrade`, plan badges, and checkout return messages.
- Local Stripe CLI forwarding through `bun run --filter=recoverage.cloud dev:stripe`.

Checkout and webhooks use `STRIPE_SECRET_KEY`, `STRIPE_SUPPORTER_PRICE_ID`, and
`STRIPE_WEBHOOK_SECRET`. A price ID is configuration, not proof that the configured
Stripe price is $1/month; confirm the actual price when preparing each environment.

## Remaining work and sequence

1. Complete the plan rework and add billing lifecycle regression tests on this
   branch. Record any discovered failures explicitly.
2. Rebase only when requested. Billing-management work follows that rebase:
   customer portal, cancellation/card management, and protection against duplicate
   subscriptions at checkout.
3. Address lifecycle failures and implement the separately proposed launch work:
   usage display, resource controls, operating procedures, and environment checks.
4. Validate a complete subscription lifecycle in an isolated Stripe test
   environment before enabling live purchases.

Organization billing, report history, private badges, automatic report retention,
and object storage are deferred.

## Lifecycle regressions found September 22

The expanded `__tests__/webhook.test.ts` exercises signed deliveries against local
D1 and mocks outbound Stripe lookups. It covers both renewal delivery orders,
scheduled and effective cancellation, overrides, duplicate deliveries, invoice
backfill, retry after failure, and signature rejection.

Three ordinary regression tests currently fail against the billing implementation:

| Scenario | Required result | Current result |
| --- | --- | --- |
| A previously unseen older subscription update arrives after cancellation | The subscription remains canceled and the user stays Free. | The old snapshot restores active status and Supporter. |
| An earlier invoice-paid event arrives after renewal | The latest invoice ID and its payment stay associated with the renewal. | The earlier invoice replaces the latest invoice fields. |
| A renewal has a new invoice whose payment timestamp is null | The prior invoice cannot prove payment of the new period. | The old payment timestamp carries over and grants Supporter. |

Keep these tests enabled and resolve the failures in subsequent billing work.
They are not skipped, inverted, or assertions that the incorrect behavior is
acceptable. The full cloud test command will remain red until they are fixed.
Subscription reconciliation must not infer state order from event timestamps:
Stripe events can share a creation second. Also preserve the association between
an invoice ID and its payment evidence instead of carrying a timestamp onto a
different invoice.

## Product copy

> Hosted reports are free for small projects. Upgrade for $1/month to support
> recoverage.cloud and host up to 100 reports across your projects.

At the report limit:

> Your Free account is hosting 3 of 3 reports. Existing reports can still be
> updated. Upgrade to Supporter for 100 hosted reports.

Storage help should explain that the same individual-report storage constraint
applies to every plan. A storage-size failure must not suggest upgrading as a fix.
