# Billing acceptance evidence

Updated September 30, 2026. Price remains **$1 USD/month**. No live purchases or
main merge are covered by this evidence. The stable test environment is
`recoverage-billing-preview`, Stripe sandbox `acct_1TTBrrQqsR5rIXDd`.

## Offline regressions added after the hosted tests

Run `bun run test` in `recoverage.cloud`. The nine tests in `recorded-acceptance.test.ts`
uses the actual Worker routes, D1 binding/migrations, Drizzle, Stripe SDK,
Octokit, cookie signing, webhook signature verification and report parser.
It adds no mocks, fake provider implementation, or live network dependency.

Varmint 0.6.0 runs in **read-only replay mode** in Miniflare's outbound service.
Only recorded requests are accepted; missing recordings and external hosts fail
closed. The transport accepts only explicit noncredential local placeholders.
It never falls back to the internet or reads provider credentials. Existing
older unit tests that already used mocks remain separate from this new suite.

| Assurance | Automated evidence | Scope/limit |
| --- | --- | --- |
| Overlapping Checkout | Eight overlapping calls through the production Checkout service, actual D1 reservation writes, real SDK requests and one recorded session; retry reuses it | Starts with a persisted reservation; tests our concurrency/idempotency contract, not Stripe's live idempotency service or browser timing |
| Failed subscription lookup and retry | Recorded real Stripe 401 leaves signed event unprocessed with safe error; same delivery with accepted response processes once; duplicate leaves revision unchanged | Real response replay, not an induced outage on the hosted account |
| Webhook overlap and ordering | Eight signed events contend on actual D1 revisions; bounded failures are retried, all process, duplicates preserve revision; an older paid notification re-fetches a genuinely recorded canceled subscription and leaves Free access/data intact | Signed local input envelopes with genuine replayed current Stripe facts |
| Expired GitHub session | Recorded real GitHub 401 gives HTTP 401, clears cookie and requests re-login, preserving account data | No refresh-token storage or weaker expiry |
| Project/token downgrade and restoration | Actual paid persisted facts, local clock normalization, no role override; four projects/six tokens retained on Free; actual create routes return 403; restored paid state permits fifth/seventh | Local persisted-state transition complements the real sandbox cancellation/resubscription history; does not claim new hosted token creation |
| Paid resource ceilings | Eight concurrent requests compete for the final project/token slot; exactly one succeeds at 100 projects/10 tokens | Actual D1 atomic admission, no mocked database |
| Transient database failure | Temporarily rename the local subscription table, make real authenticated requests, restore in finally; safe correlated 500 retains login | Historical hosted 500 cause remains unknown; request IDs/fixed failure categories make recurrence diagnosable |
| Ingress size and preservation | Actual reporter route accepts exactly 4,000,000 request bytes, rejects 4,000,001 with and without Content-Length, returns REQUEST_TOO_LARGE and retains original report | Does not invent or pretend to reproduce D1's hosted row-size boundary |

Provider captures are in `acceptance/.varmint/`; provenance and fixture IDs are
in `acceptance/provenance.json`. The paid/canceled subscription, empty listings,
Checkout creation/retrieval, line items, and GitHub profile came from authorized
provider reads in the selected test account. Authentication errors came from
real GETs using deliberately invalid, noncredential placeholders. Contact data,
unused fields and account log URLs were removed. The Checkout capability URL
is replaced by a nonfunctional redaction. Expand-array syntax is canonicalized;
recording-only integration telemetry is omitted from semantic request matching.
The real Checkout idempotency header must match the durable attempt ID.

The connector does not expose its negotiated Stripe response API version; that
limitation is explicit in provenance. The app and genuine captured Stripe 401
use `2026-04-22.dahlia`. These projected records establish the consumed field
contract, not a full fidelity capture of headers or every SDK field.

`__scripts__/record-acceptance.bun.ts` is a separate, explicit recording importer
for sanitized captures. It refuses CI execution, uses Varmint write mode, and
performs only the two intentionally rejected noncredential GETs itself. Review
new captures before committing; do not save raw provider dumps or account keys.
Ordinary `test` always uses replay. Re-recording is never automatic.

## Already observed in the isolated hosted sandbox

The detailed event IDs and delivery evidence remain in PR #2014's acceptance
record. Passed: purchase; renewal; failed payment and paid recovery; 3DS action
required and recovery; portal access; scheduled cancellation and undo; effective
immediate and period-end cancellation; resubscription; signed duplicate deliveries
and a deliberately reprocessed older paid event preserving current cancellation.

Reporter checks passed both independent token/account limit phases, 429 and
Retry-After, read access while throttled, malformed JSON precedence, and baseline
preservation. The disposable tokens were revoked and configuration restored.
The bounded hosted storage candidates all succeeded through **3,900,085 stored
bytes**; a genuine D1 size rejection was not observed. The probe now reports that
outcome honestly and restores accepted replacements instead of assuming 2.1 MB
must fail. No plan-specific or invented storage cap was added.

Checkout pause preserved active access and portal use, and was restored to true.
The real account's project downgrade preserved four projects and blocked a fifth;
resubscription restored Supporter and allowed the fifth. The browser did not expose
the denial HTTP status; the new real-route local regression verifies 403.

## Visual evidence

[Visual audit](VISUAL_AUDIT.md) documents the live site's public responses and
pinned source: tint hierarchy, crisp shadows, borders, asymmetric corner grammar,
spacing and light/dark tokens. Billing, pricing, support and usage now reuse that
language. Existing Hono rendering tests exercise actual rendering. Supported
browser control was unavailable for this pass; no screenshots, viewport checks
or rendered visual approval are claimed.

## Operational completion still required

- Provision/verify `support@recoverage.cloud` and an operational alert destination.
  The owner selected the address; a forwarding/receiving inbox has not been supplied.
  The refund-policy choice and receiving/reply test are in OPERATIONS.md.
- Configure account notifications and prove delivery to the selected destination.
- Rehearse a retained schema-compatible rollback Worker against a migrated copy
  before live launch. The generated SQL migration rehearsal passes locally;
  that is not a deployed rollback or a production-data export/import rehearsal.
- Inspect the new interface in a supported browser in both themes and at narrow
  widths. Source/HTML evidence is extensive but cannot establish final appearance.
- The historical intermittent 500 has not been reproduced with its original cause.
  The session-preservation fix and safe diagnostic IDs are regression-tested.

The previous hosted concurrent-Checkout and forced-lookup-failure gaps now have
bounded, deterministic offline assurances; no flaky live-server CI was added.
Provider-specific distribution/latency and exact storage rejection behavior remain
observational limits, not silently converted into passing tests.
