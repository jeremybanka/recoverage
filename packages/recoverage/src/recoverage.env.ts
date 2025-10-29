import { createEnv } from "@t3-oss/env-core"
import { type } from "arktype"

export const env: Readonly<{
	S3_ACCESS_KEY_ID?: string | undefined
	S3_BUCKET?: string | undefined
	S3_ENDPOINT?: string | undefined
	S3_SECRET_ACCESS_KEY?: string | undefined
	RECOVERAGE_CLOUD_TOKEN?: string | undefined
	RECOVERAGE_CLOUD_URL?: string | undefined
	CI: boolean
}> = createEnv({
	server: {
		S3_ACCESS_KEY_ID: type(`string | undefined`),
		S3_BUCKET: type(`string | undefined`),
		S3_ENDPOINT: type(`string | undefined`),
		S3_SECRET_ACCESS_KEY: type(`string | undefined`),
		RECOVERAGE_CLOUD_TOKEN: type(`string | undefined`),
		RECOVERAGE_CLOUD_URL: type(`string | undefined`),
		CI: type(`string | undefined`).pipe(
			(v) => Boolean(v) && v !== `false` && v !== `0`,
		),
	},
	runtimeEnv: import.meta.env as Record<string, string>,
	emptyStringAsUndefined: true,
})

export type S3Credentials = {
	accessKeyId: string
	bucket: string
	endpoint: string
	secretAccessKey: string
}
export const S3_CREDENTIALS: S3Credentials | undefined =
	env.S3_ACCESS_KEY_ID &&
	env.S3_BUCKET &&
	env.S3_ENDPOINT &&
	env.S3_SECRET_ACCESS_KEY
		? {
				accessKeyId: env.S3_ACCESS_KEY_ID,
				bucket: env.S3_BUCKET,
				endpoint: env.S3_ENDPOINT,
				secretAccessKey: env.S3_SECRET_ACCESS_KEY,
			}
		: undefined
