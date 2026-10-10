# Billing acceptance evidence

Updated September 30, 2026. Price remains **$1 USD/month**. No live purchases or
main merge are covered by this evidence. The stable test environment is
`recoverage-billing-preview`, Stripe sandbox `acct_1TTBrrQqsR5rIXDd`.

## Offline regressions added after the hosted tests

Run `bun run test` in `recoverage.cloud`. The thirteen tests in `recorded-acceptance.test.ts`
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
| Unconfigured PR preview | Public home/support remain 200 when any/all OAuth bindings are absent; OAuth entry/callback and protected routes fail closed, without cookies or fallback secrets | Reproduces the actual generic preview configuration; dedicated sandbox retains its configured login |
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

## Sandbox deployment and rollback follow-up

Source `b43cd93995817a8129078149a5ca488ba90442bb` passed all 18 reported GitHub
checks (preview teardown intentionally skipped), including compatibility against
`recoverage@0.1.19`. Cloud coverage is 85.16% statements, +14.11 percentage points
against main `a4d86f2f817e8a4f03f3989b27dfb4394c93006a`; 169 Worker tests pass.

The dedicated sandbox deployed that source as Worker version
`2e57a680-6f75-4e47-a9a9-b1d307804d97`. A real deployment rollback to the previously
tested schema-compatible version `b1eb15ce-99af-4f27-8e4f-fbea8523012b` succeeded:
Checkout returned 503 while paused, then the new version was restored at 100%
traffic with Checkout enabled and anonymous Checkout returning 401. Public home
and support returned 200. Exact nonsecret bindings and secret names matched;
project records, report metadata/lengths, token counts and subscription/payment
facts for the two lifecycle accounts matched before and after. No D1 writes,
Stripe mutations, new credentials, live deployment or main merge were involved.

The first Python urllib smoke client received 403; the already-used unauthenticated
curl client returned 200. The corrected harness completed rollback/restoration.
This client discrepancy is separate from the earlier authenticated billing 500.
The exclusive deployment window was released after verification. Generic PR
preview passed deployment with Stripe test mode and Checkout disabled, but its
public smoke test exposed missing OAuth bindings causing configuration 500s.
The follow-up fix makes those bindings optional to parse and mandatory only
for the routes that use them: public pages render, unavailable sign-in returns
503, and no fallback credentials are introduced. Four additional real-runtime
regressions cover each missing binding and all missing together.

## Operational completion still required

- The owner confirmed receipt at the private destination of test messages sent
  through Cloudflare forwarding to `support@recoverage.cloud` and
  `developer-alerts@recoverage.cloud`. The sandbox support binding now uses the
  public support address; its test-only refund policy remains unchanged.
  Verify outbound support replies separately; see OPERATIONS.md.
- Configure account notifications and prove delivery to the selected destination.
- The generated SQL rehearsal and actual sandbox Worker rollback now pass.
  Before live launch, rehearse export/import and migration of a representative
  production-data copy in a private disposable database; no production export
  or restoration is claimed here.
- Inspect the new interface in a supported browser in both themes and at narrow
  widths. Source/HTML evidence is extensive but cannot establish final appearance.
- The historical intermittent 500 has not been reproduced with its original cause.
  The session-preservation fix and safe diagnostic IDs are regression-tested.

The previous hosted concurrent-Checkout and forced-lookup-failure gaps now have
bounded, deterministic offline assurances; no flaky live-server CI was added.
Provider-specific distribution/latency and exact storage rejection behavior remain
observational limits, not silently converted into passing tests.
