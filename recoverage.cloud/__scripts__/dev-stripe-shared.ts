export const TEMP_ENV_NAME = `stripe-local`
export const DEFAULT_WRANGLER_PORT = 8787
export const STRIPE_EVENTS = [
	`checkout.session.completed`,
	`customer.subscription.created`,
	`customer.subscription.updated`,
	`customer.subscription.deleted`,
	`invoice.paid`,
]

export function extractWebhookSecret(text: string): string | undefined {
	return text.match(/whsec_[A-Za-z0-9]+/u)?.[0]
}

export function wranglerPortFromArgs(args: string[]): number {
	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index]
		if (arg === `--port`) {
			const value = Number(args[index + 1])
			if (Number.isInteger(value) && value > 0) {
				return value
			}
		}
		if (arg?.startsWith(`--port=`)) {
			const value = Number(arg.slice(`--port=`.length))
			if (Number.isInteger(value) && value > 0) {
				return value
			}
		}
	}

	return DEFAULT_WRANGLER_PORT
}

export function injectWebhookSecret(
	devVarsContents: string,
	webhookSecret: string,
): string {
	const lines = devVarsContents
		.split(`\n`)
		.filter((line) => !line.startsWith(`STRIPE_WEBHOOK_SECRET=`))
	const trimmed = lines.join(`\n`).trimEnd()
	return `${trimmed}\nSTRIPE_WEBHOOK_SECRET="${webhookSecret}"\n`
}
