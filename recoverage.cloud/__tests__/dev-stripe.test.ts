import {
	extractWebhookSecret,
	injectWebhookSecret,
	wranglerPortFromArgs,
} from "../__scripts__/dev-stripe-shared"

test(`extracts Stripe webhook secrets from CLI output`, () => {
	expect(
		extractWebhookSecret(
			`Ready! Your webhook signing secret is 'whsec_123abc' (^C to quit)`,
		),
	).toBe(`whsec_123abc`)
})

test(`injects a freshly discovered webhook secret into .dev.vars content`, () => {
	expect(
		injectWebhookSecret(
			`GITHUB_CLIENT_ID="abc"\nSTRIPE_WEBHOOK_SECRET="old"\nCOOKIE_SECRET="xyz"\n`,
			`whsec_new`,
		),
	).toBe(
		`GITHUB_CLIENT_ID="abc"\nCOOKIE_SECRET="xyz"\nSTRIPE_WEBHOOK_SECRET="whsec_new"\n`,
	)
})

test(`finds the wrangler port from forwarded args`, () => {
	expect(wranglerPortFromArgs([])).toBe(8787)
	expect(wranglerPortFromArgs([`--port`, `4444`])).toBe(4444)
	expect(wranglerPortFromArgs([`--port=5555`])).toBe(5555)
})
