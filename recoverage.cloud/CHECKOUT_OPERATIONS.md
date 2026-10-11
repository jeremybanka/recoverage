# Checkout protection and recovery

Checkout uses one durable attempt per GitHub account and Stripe idempotency keys
to prevent repeated or concurrent requests from opening independent purchases.
The attempt records its original price, return origin, expiry, and Stripe session
ID. Stripe remains the source for current subscription and session status;
webhook lag must never cause a second subscription to be offered.

Before deploying this change:

- Apply generated migration `0005_grey_proemial_gods.sql` through the normal D1
  migration command. Do not manually create or edit its table.
- Configure the `CHECKOUT_LIMITER` Worker binding from `wrangler.jsonc`. Its
  initial allowance is 10 requests per minute per authenticated account. The key
  includes `REPORT_RATE_SCOPE` to keep deployment environments separate. Rate
  limits are approximate resource protection; the durable attempt and Stripe
  checks provide purchase correctness.
- Include the account/portal management change providing `/ui/billing` before
  enabling purchases. Existing subscribers, including those awaiting payment,
  are sent there to manage the existing subscription.
- Complete the Stripe environment and lifecycle checks in [OPERATIONS.md](OPERATIONS.md).
  Deterministic tests do not replace a test-mode checkout, renewal, cancellation,
  and resubscription using the actual configured Stripe resources.

An open, verified Supporter session is reused after a user abandons Checkout.
Expired sessions created by the current attempt permit a new attempt. When an
older session was adopted from before this safeguard, its reservation must also
reach the fixed attempt deadline before replacement, even if that session has
already expired or its subscription has ended. This prevents a concurrent request
using the reserved idempotency key from creating another purchase. Every
nonterminal subscription blocks a new purchase, including incomplete, past-due,
unpaid, paused, and trialing states.
Resolve that subscription through billing management or support. Only a terminal
canceled or incomplete-expired subscription allows resubscription.

New sessions have a fixed one-hour deadline. Stripe requires at least 30 minutes
remaining when first creating a session. If a failed attempt has never created a
session and falls inside that final window, checkout waits for its original
deadline instead of rotating the reservation early. The response supplies
`Retry-After` and a wait time. A price or account mismatch on an existing open
session also fails closed until that session expires. Ordinary throttling returns
`429` with a 60-second retry interval; provider or reservation failures return
`503` without exposing customer details.

For a stuck purchase, identify the customer's sessions and subscriptions in the
matching Stripe environment, then inspect the account's `stripeCheckoutAttempts`
row. Retry the same account flow after correcting a provider/configuration error;
it can recover a successful Stripe creation whose response was lost. Do not delete
the attempt, change its expiry, or tell the customer to open another account to
bypass it: an earlier Checkout session may still accept payment. Escalate an
unresolved ownership mismatch to the maintainer.

The Stripe source-map install workaround replaces files atomically so Bun's
shared dependency cache and other worktrees remain intact. Repeated installation
also repairs the partially patched cache state left by older workaround runs.
