# Proposal: finish the paid-service launch

September 22, 2026. Proposed work, not a deployment plan already in progress.
The product decisions are in [PAID_SERVICE_PROPOSAL.md](PAID_SERVICE_PROPOSAL.md).

## Scope and order

Keep D1 storage and sell hosted-report capacity at the existing account limits.
Do not introduce object storage, byte-based plan tiers, organization billing, or
report history for this launch.

The plan rework and local lifecycle fixes are complete. Rebase only when
requested. Customer portal and duplicate-subscription prevention follow the
rebase; they are prerequisites for accepting live subscriptions. The work below
can then be delivered in three small changes: usage and errors, resource controls,
and operational readiness.

Local regression coverage now checks stale subscription snapshots, delayed invoice
payments, and unpaid renewals against the
[billing lifecycle guarantees](PAID_SERVICE_PROPOSAL.md#billing-lifecycle-guarantees).
Keep those tests as a gate while completing the remaining billing management and
real Stripe test-mode validation.

## 1. Show usage and explain limits

Add an account panel next to the existing plan badge:

- `Hosted reports: 12 / 100`, counted across the authenticated user's projects.
- `Projects: 4 / 100`, with token usage on each project (`2 / 10 tokens`).
- For the explicit report-count exemption, show the count and an exemption label
  instead of a fictitious maximum. Project/token limits still apply.
- At or above a quota, explain which creation operation is unavailable. Keep
  existing report updates and reads available, including after downgrade.
- Keep plan and allowance values sourced from the existing permission helpers.
  Do not add a second set of constants to UI code.

The pricing cards should continue to show report counts, projects, and tokens.
Put individual-report storage constraints in concise help text and documentation,
without suggesting that an upgrade allows a larger report.

Normalize report errors so CI can distinguish invalid credentials, exhausted
report slots, excessive request frequency, and a report that will not fit storage.
Translate a confirmed D1 size error into a useful `413` response while leaving
unrelated database failures as server errors. Verify the actual error shape in
the Worker runtime and test that a rejected replacement leaves the old report
intact. Explain the storage constraint in user terms, with the backend details in
the troubleshooting documentation.

Do not promise a raw upload size based on D1's row limit: coverage, summary,
metadata, and row overhead share that limit. The provider remains authoritative.

Acceptance: an account with reports in two projects sees the combined count;
replacements do not increase it; downgrading an over-quota account preserves its
existing reports; exempt accounts see truthful usage; a storage-size error never
suggests upgrading.

## 2. Bound request load independently of paid capacity

Report count bounds retained report storage, but it does not bound how often CI
can replace a report or how much work a rejected upload consumes.

Start with the Workers rate-limiting binding on authenticated reporter PUTs. Key
it by the verified token ID and by the owning GitHub user ID so rotating between
projects or tokens does not evade all controls. Do not use raw secrets as keys.
Use the same rate policy for public plans initially; this is resource protection,
not another paid feature. Apply it before buffering/parsing coverage JSON.

Proposed starting budgets are 120 uploads per minute per token and 600 per minute
per account, then tune against observed CI bursts. These are configuration choices
for this proposal, not entitlements or constants to add now. Validate a 100-report
monorepo upload burst before launch. Return `429` with retry guidance; preserve
authentication errors and test the CLI's behavior when throttled. Any automatic
retry should be bounded and respect `Retry-After`.

Cloudflare describes this binding as approximate and scoped to a location. It is
suitable for coarse load control, not precise global metering. Keep durable report
quotas in D1 and close the current count-then-insert race before describing the
account quota as strict under concurrent uploads. Do not use a rate limiter as a
substitute for that fix. See [Workers rate limiting](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/).

Add a shared ingress/resource guard based on the actual storage format and Worker
memory budget. Check streamed bytes, including when Content-Length is absent or
untrustworthy, rather than buffering arbitrarily large bodies before rejection.
This must remain independent of plan roles. It does not require a new customer
promise about report size.

Do not put Stripe webhook retries behind reporter limits. Give checkout its own
small per-user limit when implementing billing management. Keep badges/downloads
out of the upload budget so a noisy CI job does not disable reads.

Acceptance: requests cannot evade account throttling by changing tokens; exhausted
budgets reject before expensive upload processing; report replacements count as
requests; normal monorepo bursts work; concurrent new reports cannot exceed quota.

## 3. Establish support and operating procedures

Add a visible billing support contact chosen by the maintainer to the account and
upgrade pages. Publish the same contact in the hosted-service documentation.

Write a small runbook covering:

| Situation | Procedure to document and rehearse |
| --- | --- |
| Payment succeeded but account remains Free | Find the user/customer/subscription, inspect processed and failed events, retrieve current Stripe facts, and retry synchronization without asking the user to buy again. |
| Failed webhook delivery | Inspect `processingError` and delivery logs, correct the cause, resend the event, and confirm the error clears. |
| Signing-secret rotation | Coordinate Stripe's overlap window with Worker configuration, verify a signed delivery with the new secret, and retire the old secret. |
| Manual entitlement | Set or clear `manualRoleOverride` for a verified GitHub user; record who changed it and why. Clearing it resumes billing-derived access. |
| Cancellation or refund | Use Stripe's supported management flow and verify the resulting entitlement; define refund policy explicitly because a refund alone is not a cancellation policy. |
| Service incident | Disable new checkout while preserving webhooks, existing subscriber access, uploads, and reads where possible; repair billing state before reopening purchases. |

Log event IDs, outcomes, and durations without logging full report bodies, tokens,
or raw payment payloads. The current reporter logs its parsed payload, and the
database logger prints query parameters, including stored event payloads. Remove
or redact both in this work. Monitor failed webhook processing, D1 capacity, upload
errors, throttling, and Worker resource failures. Full event payloads are already
stored in D1, so define their retention separately from a compact processed-event
deduplication record; report-count quotas do not bound webhook-table growth.

Acceptance: the maintainer can recover a missed payment update, rotate a secret,
apply/remove an override, and pause new purchases from the written instructions.

## 4. Verify environments and release deliberately

Use a stable isolated billing preview with its own D1 database, OAuth callback,
Stripe test price/customer data, and webhook endpoint. Generic PR previews
currently create a Worker and database but do not provision the complete billing
configuration. Make that setup explicit before using them to validate payments.

For each environment, record and verify:

- Worker URL, D1 binding, OAuth callback, and cookie secret.
- Stripe API key, Supporter price ID, and endpoint signing secret, all belonging
  to the same test or live environment. Never commit their values.
- The price is the intended $1 monthly recurring offer and the endpoint API
  version matches the integration (`2026-04-22.dahlia` today).
- Subscriptions, invoice payments, and checkout completion are enabled on the
  endpoint; the customer portal is configured once implemented.
- Test-mode events cannot mutate live entitlements and vice versa.

In preview, exercise signup, purchase, webhook arrival, refreshed entitlement,
report upload, renewal, payment failure, card update, cancellation, and downgrade.
Replay duplicate events, deliver lifecycle events in a different order, and retry
failed processing. Keep the deterministic local regressions as the first gate;
they do not replace a real Stripe test-mode checkout.

Before live purchases, apply generated migrations to a disposable copy of
representative existing data, validate the result, and prepare a schema-compatible
rollback. In particular, the billing migration replaces `users.role`; rolling
back only the Worker to old code is not sufficient. Generate any needed schema
changes with drizzle-kit rather than editing existing migrations.

Deploy with a proposed checkout-enable switch off, configure and verify live
bindings and webhook delivery, then enable checkout after the preview lifecycle
and operational checks pass. Disabling checkout must not remove the configured
Supporter price or prevent existing customers from retaining their entitlement.

## Completion criteria

Live purchases wait for billing management, lifecycle regressions, accurate usage
and error messages, basic load controls, support procedures, and an isolated
end-to-end test to be complete. Launch does not depend on moving to object storage
or offering different individual-report sizes.

The maintainer still needs to choose the support contact and refund policy, and
confirm the preview/live Stripe resources. Those choices do not block writing the
local changes above.
