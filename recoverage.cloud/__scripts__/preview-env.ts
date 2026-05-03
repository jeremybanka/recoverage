import { createEnv } from "@t3-oss/env-core"
import { type } from "arktype"

export const optionalString = type(`string | undefined`)

export type PreviewEnv = Readonly<{
	CLOUDFLARE_ACCOUNT_ID?: string | undefined
	CLOUDFLARE_API_TOKEN?: string | undefined
	DATABASE_ID?: string | undefined
	DATABASE_NAME: string
	GITHUB_OUTPUT?: string | undefined
	WORKER_NAME: string
}>

export function getPreviewEnv(
	runtimeEnv: Record<string, string | undefined> = process.env,
): PreviewEnv {
	return createEnv({
		server: {
			CLOUDFLARE_ACCOUNT_ID: optionalString,
			CLOUDFLARE_API_TOKEN: optionalString,
			DATABASE_ID: optionalString,
			DATABASE_NAME: type(`string`),
			GITHUB_OUTPUT: optionalString,
			WORKER_NAME: type(`string`),
		},
		runtimeEnv,
		emptyStringAsUndefined: true,
	})
}
