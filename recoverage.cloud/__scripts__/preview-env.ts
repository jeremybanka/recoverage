import { createEnv } from "@t3-oss/env-core"
import { type } from "arktype"

export const optionalString = type(`string | undefined`)

export type PreviewD1Env = Readonly<{
	CLOUDFLARE_API_TOKEN?: string | undefined
	DATABASE_NAME: string
	GITHUB_OUTPUT?: string | undefined
}>

export type PreviewConfigEnv = PreviewD1Env &
	Readonly<{
		DATABASE_ID: string
		WORKER_NAME: string
	}>

export type PreviewTeardownEnv = PreviewD1Env &
	Readonly<{
		WORKER_NAME: string
	}>

export function getPreviewD1Env(
	runtimeEnv: Record<string, string | undefined> = process.env,
): PreviewD1Env {
	return createEnv({
		server: {
			CLOUDFLARE_API_TOKEN: optionalString,
			DATABASE_NAME: type(`string`),
			GITHUB_OUTPUT: optionalString,
		},
		runtimeEnv,
		emptyStringAsUndefined: true,
	})
}

export function getPreviewConfigEnv(
	runtimeEnv: Record<string, string | undefined> = process.env,
): PreviewConfigEnv {
	return createEnv({
		server: {
			CLOUDFLARE_API_TOKEN: optionalString,
			DATABASE_ID: type(`string`),
			DATABASE_NAME: type(`string`),
			GITHUB_OUTPUT: optionalString,
			WORKER_NAME: type(`string`),
		},
		runtimeEnv,
		emptyStringAsUndefined: true,
	})
}

export function getPreviewTeardownEnv(
	runtimeEnv: Record<string, string | undefined> = process.env,
): PreviewTeardownEnv {
	return createEnv({
		server: {
			CLOUDFLARE_API_TOKEN: optionalString,
			DATABASE_NAME: type(`string`),
			GITHUB_OUTPUT: optionalString,
			WORKER_NAME: type(`string`),
		},
		runtimeEnv,
		emptyStringAsUndefined: true,
	})
}
