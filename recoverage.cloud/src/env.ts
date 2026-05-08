import { createEnv } from "@t3-oss/env-core"
import { type } from "arktype"

export type Bindings = {
	DB: D1Database
	GITHUB_CLIENT_ID: string
	GITHUB_CLIENT_SECRET: string
	COOKIE_SECRET: string
	STRIPE_SECRET_KEY?: string | undefined
	STRIPE_WEBHOOK_SECRET?: string | undefined
	STRIPE_SUPPORTER_PRICE_ID?: string | undefined
}

export type Env = Readonly<{
	COOKIE_SECRET: string
	GITHUB_CLIENT_ID: string
	GITHUB_CLIENT_SECRET: string
	STRIPE_SECRET_KEY?: string | undefined
	STRIPE_WEBHOOK_SECRET?: string | undefined
	STRIPE_SUPPORTER_PRICE_ID?: string | undefined
}>

export function getEnv(bindings: Bindings): Env {
	return createEnv({
		server: {
			COOKIE_SECRET: type(`string`),
			GITHUB_CLIENT_ID: type(`string`),
			GITHUB_CLIENT_SECRET: type(`string`),
			STRIPE_SECRET_KEY: type(`string | undefined`),
			STRIPE_WEBHOOK_SECRET: type(`string | undefined`),
			STRIPE_SUPPORTER_PRICE_ID: type(`string | undefined`),
		},
		runtimeEnv: {
			COOKIE_SECRET: bindings.COOKIE_SECRET,
			GITHUB_CLIENT_ID: bindings.GITHUB_CLIENT_ID,
			GITHUB_CLIENT_SECRET: bindings.GITHUB_CLIENT_SECRET,
			STRIPE_SECRET_KEY: bindings.STRIPE_SECRET_KEY,
			STRIPE_WEBHOOK_SECRET: bindings.STRIPE_WEBHOOK_SECRET,
			STRIPE_SUPPORTER_PRICE_ID: bindings.STRIPE_SUPPORTER_PRICE_ID,
		},
		emptyStringAsUndefined: true,
	})
}

export const GITHUB_CALLBACK_ENDPOINT = `/oauth/github/callback`
