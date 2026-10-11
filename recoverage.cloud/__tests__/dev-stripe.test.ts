import {
	assertLocalWranglerArgs,
	extractWebhookSecret,
	injectWebhookSecret,
	stripeListenerEnv,
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

test.each([`sk_test_placeholder`, `rk_test_placeholder`])(
	`listener uses the exact Worker test key %s instead of ambient CLI credentials`,
	(key) => {
		const inherited = { STRIPE_API_KEY: `sk_live_ambient`, PATH: `/test/bin` }
		const listenerEnv = stripeListenerEnv(
			`STRIPE_MODE = "test" # isolated sandbox\nSTRIPE_SECRET_KEY = "${key}"\n`,
			inherited,
		)
		expect(listenerEnv).toEqual({ STRIPE_API_KEY: key, PATH: `/test/bin` })
		expect(inherited.STRIPE_API_KEY).toBe(`sk_live_ambient`)
	},
)

test.each([
	`STRIPE_MODE=live\nSTRIPE_SECRET_KEY=sk_test_placeholder`,
	`STRIPE_SECRET_KEY=sk_test_placeholder`,
	`STRIPE_MODE=test`,
	`STRIPE_MODE=test\nSTRIPE_SECRET_KEY=sk_live_placeholder`,
	`STRIPE_MODE=test\nSTRIPE_SECRET_KEY=rk_live_placeholder`,
	`STRIPE_MODE=test\nSTRIPE_SECRET_KEY=pk_test_placeholder`,
])(
	`listener rejects an unsafe or incomplete Worker configuration`,
	(contents) => {
		expect(() => stripeListenerEnv(contents, {})).toThrow(
			`Local billing requires STRIPE_MODE=test and a test secret or restricted key in .dev.vars.`,
		)
	},
)

test.each(
	[
		[`--remote`],
		[`--remote=true`],
		[`--env`, `production`],
		[`-eproduction`],
		[`--config=other.jsonc`],
		[`-c`, `other.jsonc`],
		[`--var`, `STRIPE_MODE:live`],
		[`-vSTRIPE_MODE:live`],
	].map((args) => ({ args })),
)(
	`local billing refuses arguments that bypass its isolated config`,
	({ args }) => {
		expect(() => {
			assertLocalWranglerArgs(args)
		}).toThrow(
			`Local billing cannot override the local mode, environment, config, or variables.`,
		)
	},
)

test(`local billing retains ordinary forwarded Wrangler arguments`, () => {
	expect(() => {
		assertLocalWranglerArgs([`--port`, `4444`, `--local`, `--log-level=debug`])
	}).not.toThrow()
})

test(`a signing secret split across listener chunks waits for its delimiter`, () => {
	let output = `Ready! Your webhook signing secret is 'whsec_first`
	expect(extractWebhookSecret(output)).toBeUndefined()
	output += `Second123`
	expect(extractWebhookSecret(output)).toBeUndefined()
	output += `' (^C to quit)\n`
	expect(extractWebhookSecret(output)).toBe(`whsec_firstSecond123`)
})

test.each([` `, `\n`, `"`, `'`])(
	`a complete signing secret accepts the known delimiter %j`,
	(delimiter) => {
		expect(extractWebhookSecret(`whsec_placeholder${delimiter}`)).toBe(
			`whsec_placeholder`,
		)
	},
)
