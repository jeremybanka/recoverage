# Proposal: $1/mo Hosted Coverage Reports

## Goal

Turn recoverage.cloud into a tiny paid service for hosted coverage reports while keeping the existing free tier useful.

The paid offer should be simple:

- Free: enough for small projects and demos.
- Supporter: $1/month for much higher hosted-report limits.
- No feature maze. The thing people pay for is more hosted coverage capacity and support for the service existing.

## Current Service

recoverage.cloud currently provides:

- GitHub OAuth login.
- Users stored by GitHub user ID.
- One role: `free`.
- Projects owned by users.
- Upload tokens scoped to projects.
- Coverage report upload/download via `RECOVERAGE_CLOUD_TOKEN`.
- Public Shields-compatible badge JSON at `/shields/:projectId/:reportRef`.
- Reports stored directly in D1 as JSON text.

Current free limits are encoded in `src/roles-permissions.ts`:

- 3 projects per user.
- 12 tokens per project.
- 3 reports per project.

The CLI uploads only from the default branch when `RECOVERAGE_CLOUD_TOKEN` is present. The report ref defaults to the package directory name, so in practice a report maps well to "one package coverage baseline".

This means the cloud product is not currently a history/archive product. It stores the latest baseline for a report ref and updates that baseline in place.

## Recommended Product Shape

### Free

Replace the current free tier with a smaller, clearer hosted report allowance:

- 3 hosted reports total.
- 5 MB per report.
- No credit card.

This is enough to try the hosted workflow on a real project, including a small monorepo with multiple packages, while keeping the free storage promise very small and clear.

### Supporter: $1/month

Add a single paid role:

- 100 hosted reports total.
- 25 MB per report.
- Same upload/download API.
- Same public badges.
- "Supporter" status in the UI.

The paid limits are intentionally high but bounded. At $1/month, the product should remain emotionally easy to buy, but the system still needs caps so one account cannot turn hosted reports into unbounded object storage.

### Admin/Manual Override

Add an internal `admin` role or a manual `comped` role:

- Used for your own projects, demos, sponsored users, and support recovery.
- Not exposed as a public plan.

## Important Technical Correction

The current report-limit check counts all reports before every PUT:

```ts
if (currentReports.length >= numberOfReportsAllowed) {
  return c.json({ error: `You may not create more reports` }, 401)
}
```

Because reports are upserted, this blocks updates once a project is at its current report limit, even when the upload is replacing an existing report ref. Before paid tiers launch, change the check to allow updates to existing refs and only reject creation of a new ref when the account is at its hosted-report limit.

This matters for both free and paid users because CI should always be able to refresh an existing baseline.

## Billing Provider

Use a hosted checkout provider rather than building card handling.

Recommended path:

- Stripe Checkout for the first version.
- Stripe Customer Portal for cancellation and card management.
- Webhooks to update local subscription state.

Why Stripe:

- It is boring in the good way.
- Checkout and Customer Portal keep PCI/card handling out of the app.
- Cloudflare Workers can receive signed webhooks.
- A $1 recurring price is a normal Stripe subscription object.

Alternative: Polar or Lemon Squeezy could reduce merchant-of-record/accounting work depending on your preferences, but the app integration shape is similar: checkout session, webhook, local entitlement.

## Data Model Changes

Extend `users`:

- `role`: keep, but add paid roles to the role type.
- `stripeCustomerId`: nullable text.
- `stripeSubscriptionId`: nullable text.
- `subscriptionStatus`: nullable text.
- `currentPeriodEnd`: nullable timestamp/text.
- `billingEmail`: nullable text.

Add `billingEvents`:

- `id`: provider event ID primary key.
- `type`: event type.
- `createdAt`: timestamp.
- `payload`: JSON text.

The event table gives idempotency and makes webhook debugging much easier.

Role assignment should be derived from billing state:

- Active/trialing subscription -> `supporter`.
- Canceled/unpaid/past_due after grace period -> `free`.
- Manual roles like `admin` should not be overwritten by Stripe webhooks.

## Role/Permission Changes

Update `src/roles-permissions.ts`:

- Add roles: `free`, `supporter`, `admin`.
- Add permissions for larger limits.
- Keep the existing `Escalator` pattern.

Suggested public limits:

| Role | Hosted Reports | Max Report Size |
| --- | ---: | ---: |
| free | 3 | 5 MB |
| supporter | 100 | 25 MB |
| admin | 200 | 50 MB |

The paid product should meter hosted reports at the account level, not reports per project. That lets users spend their allowance however their codebase is shaped:

- 100 repos with one report each.
- 1 monorepo with 100 package reports.
- Something in the middle.

Projects should remain grouping and credential boundaries. A project can represent a repo, a monorepo, an organization area, or any bucket of reports that should share upload tokens.

Suggested supporting limits:

| Role | Projects | Tokens per Project |
| --- | ---: | ---: |
| free | 3 | 5 |
| supporter | 100 | 10 |
| admin | 200 | 25 |

These caps are not the product promise; they are guardrails against clutter and accidental token sprawl. The thing a user is buying is hosted reports.

Implementation detail: enforcing an account-level hosted-report limit requires counting reports across all projects owned by the user. The create-report path should:

- Authenticate the upload token.
- Check whether the target `(projectId, reportRef)` already exists.
- If it exists, allow the update.
- If it does not exist, count all reports owned by the project owner.
- Reject only when creating a new report would exceed the account's hosted-report allowance.

If larger reports become common, move report bodies from D1 to R2 and keep only metadata/summaries in D1.

## UI Changes

Keep the UI practical:

- Show the current plan near the GitHub identity.
- Show usage counts: hosted reports, projects, report size, tokens.
- When a limit is reached, disable creation and show the tier limit.
- Add "Upgrade: $1/mo" for free users.
- Add "Manage billing" for paid users.
- Add a small "Thank you for supporting recoverage.cloud" note for paid users.

Avoid a complex pricing page. A single compact billing panel is enough.

## API/Route Changes

Add billing routes:

- `POST /billing/checkout`
  - Requires GitHub session.
  - Creates/fetches provider customer.
  - Creates hosted checkout session.
  - Redirects to provider checkout.

- `POST /billing/portal`
  - Requires GitHub session.
  - Redirects paid users to hosted billing portal.

- `POST /billing/webhook`
  - No GitHub session.
  - Verifies provider signature.
  - Idempotently stores event.
  - Updates user subscription fields and role.

Add user-facing entitlement helpers:

- `getUserPlan(user)`
- `getProjectLimit(role)`
- `getTokenLimit(role)`
- `getReportLimit(role)`
- `getReportSizeLimit(role)`

Centralizing these avoids scattering role logic across UI and reporter routes.

## Storage Strategy

Phase 1 can keep D1 storage:

- Current reports are already D1 text columns.
- The paid plan is cheap and simple.
- The fastest launch is fewer moving parts.

But we should make two changes now:

- Store calculated report byte size on the report row.
- Enforce per-role upload size before parsing and storing.

Phase 2 should move raw coverage maps to R2 if usage grows:

- D1 stores project/report metadata and JSON summary.
- R2 stores the full coverage map by key: `projectId/reportRef/latest.json`.
- This reduces D1 pressure and makes storage costs more predictable.

## Abuse and Operational Limits

Before charging money, add:

- Upload body size limits.
- Update-existing-report behavior at the report limit.
- Basic rate limiting by token/project, even if coarse.
- Better error text for limit failures.
- A support contact in the billing panel.

Do not promise permanent retention yet. Say "host your current coverage reports" rather than "archive every report forever." The current model stores one report per ref, updated in place.

## Implementation Plan

### Milestone 1: Entitlements and Limit Correctness

- Add `supporter` and `admin` roles.
- Update permission tests for all roles.
- Fix report upsert limit behavior.
- Add per-role report size limits.
- Improve limit error messages.

This milestone is valuable even without billing because it makes the free service more correct.

### Milestone 2: Billing Data and Webhooks

- Add user billing columns.
- Add `billingEvents`.
- Add billing environment variables.
- Implement webhook verification.
- Map subscription status to user role.
- Add tests for duplicate webhook delivery and status changes.

### Milestone 3: Checkout and Portal

- Add checkout route.
- Add portal route.
- Add UI billing panel.
- Add success/cancel return states.
- Add "Manage billing" for existing subscribers.

### Milestone 4: Polish and Launch Safety

- Add usage counts to project UI.
- Document free/supporter limits.
- Update package README hosted option language.
- Add production runbook: webhook secret rotation, manual role override, refund/cancel handling.
- Deploy behind a preview environment first.

## Testing Plan

Add focused tests for:

- Free user cannot create a fourth hosted report across any project arrangement.
- Supporter can create up to 100 hosted reports across any project arrangement.
- Existing report can be updated when the account is at the hosted-report limit.
- New report is rejected when the account is at the hosted-report limit.
- Upload over size limit is rejected.
- Webhook event is idempotent.
- Active subscription upgrades role.
- Canceled/unpaid subscription downgrades role unless the user has an internal role.

Most of this can fit into the existing Cloudflare/Vitest setup.

## Copy

Suggested product copy:

> Hosted reports are free for small projects. Upgrade for $1/month to support recoverage.cloud and raise your limits.

Suggested free limit message:

> Free accounts can host 3 coverage reports up to 5 MB each. Upgrade to Supporter for 100 hosted reports up to 25 MB each.

Suggested paid label:

> Supporter plan: $1/month. Thank you for keeping recoverage.cloud running.

## Open Questions

- Should the paid plan be per GitHub user only, or eventually per GitHub organization?
- Should report refs remain package-name based, or should the CLI support an explicit `RECOVERAGE_REPORT_REF`?
- Should badges be public forever, or should projects eventually choose public/private badges?
- Should old report refs have retention/cleanup controls, or is manual deletion enough?

## Recommendation

Launch with one paid plan: `supporter` at $1/month.

Make free small and useful: 3 hosted reports, enough to feel the monorepo convenience without turning free into storage. Make the paid tier feel like a friendly contribution with practical benefits, not an enterprise pricing system. Build the first version around account-level hosted-report limits, Stripe-hosted checkout, webhook-driven entitlements, and strict but generous size caps. Defer organization billing, R2 migration, and advanced privacy controls until real usage shows they are needed.
