import { parseEnv } from "node:util"

import { billingEvents } from "../src/billing-config"

export const TEMP_ENV_NAME = `stripe-local`
export const DEFAULT_WRANGLER_PORT = 8787
export const STRIPE_EVENTS = billingEvents

export function extractWebhookSecret(text: string): string | undefined {
	return text.match(/whsec_[A-Za-z0-9]+(?=[\s'"])/u)?.[0]
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

export function stripeListenerEnv(
	devVarsContents: string,
	inheritedEnv: Record<string, string | undefined>,
): Record<string, string | undefined> {
	const config = parseEnv(devVarsContents)
	const key = config[`STRIPE_SECRET_KEY`]
	if (
		config[`STRIPE_MODE`] !== `test` ||
		!key ||
		!/^(?:sk|rk)_test_[A-Za-z0-9]+$/u.test(key)
	) {
		throw new Error(
			`Local billing requires STRIPE_MODE=test and a test secret or restricted key in .dev.vars.`,
		)
	}
	// Explicitly override any ambient CLI account/key with the Worker test key.
	return { ...inheritedEnv, STRIPE_API_KEY: key }
}

export function assertLocalWranglerArgs(args: string[]): void {
	const forbidden = new Set([
		`--remote`,
		`--env`,
		`-e`,
		`--config`,
		`-c`,
		`--var`,
		`-v`,
	])
	if (
		args.some(
			(arg) => forbidden.has(arg.split(`=`)[0] ?? ``) || /^-[ecv].+/u.test(arg),
		)
	) {
		throw new Error(
			`Local billing cannot override the local mode, environment, config, or variables.`,
		)
	}
}
