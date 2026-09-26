#!/usr/bin/env bun

import { spawn } from "node:child_process"
import { readFile, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

import {
	extractWebhookSecret,
	injectWebhookSecret,
	STRIPE_EVENTS,
	TEMP_ENV_NAME,
	wranglerPortFromArgs,
} from "./dev-stripe-shared.ts"

function spawnStripeListener({
	forwardTo,
	projectDir,
}: {
	forwardTo: string
	projectDir: string
}) {
	return spawn(
		`stripe`,
		[`listen`, `--events`, STRIPE_EVENTS.join(`,`), `--forward-to`, forwardTo],
		{
			cwd: projectDir,
			stdio: [`inherit`, `pipe`, `pipe`],
		},
	)
}

function spawnWranglerDev({
	projectDir,
	wranglerArgs,
}: {
	projectDir: string
	wranglerArgs: string[]
}) {
	return spawn(
		`bun`,
		[
			`run`,
			`wrangler`,
			`dev`,
			`--env`,
			TEMP_ENV_NAME,
			`--live-reload`,
			...wranglerArgs,
		],
		{
			cwd: projectDir,
			env: process.env,
			stdio: [`inherit`, `inherit`, `inherit`],
		},
	)
}

async function waitForWebhookSecret(
	stripeProcess: ReturnType<typeof spawnStripeListener>,
): Promise<string> {
	let bufferedOutput = ``

	return new Promise<string>((resolve, reject) => {
		let resolved = false

		const onData = (chunk: Buffer) => {
			const text = chunk.toString(`utf8`)
			process.stdout.write(`[stripe] ${text}`)
			bufferedOutput += text
			const webhookSecret = extractWebhookSecret(bufferedOutput)
			if (webhookSecret && !resolved) {
				resolved = true
				resolve(webhookSecret)
			}
		}

		const onError = (chunk: Buffer) => {
			const text = chunk.toString(`utf8`)
			process.stderr.write(`[stripe] ${text}`)
			bufferedOutput += text
			const webhookSecret = extractWebhookSecret(bufferedOutput)
			if (webhookSecret && !resolved) {
				resolved = true
				resolve(webhookSecret)
			}
		}

		stripeProcess.stdout.on(`data`, onData)
		stripeProcess.stderr.on(`data`, onError)
		stripeProcess.on(`exit`, (code) => {
			if (resolved) {
				return
			}
			reject(
				new Error(
					`Stripe CLI exited before yielding a webhook secret (exit code ${code ?? -1}).`,
				),
			)
		})
		stripeProcess.on(`error`, reject)
	})
}

export async function main(argv = process.argv.slice(2)): Promise<number> {
	const wranglerArgs = argv
	const wranglerPort = wranglerPortFromArgs(wranglerArgs)
	const projectDir = path.resolve(
		path.dirname(fileURLToPath(import.meta.url)),
		`..`,
	)
	const devVarsPath = path.join(projectDir, `.dev.vars`)
	const tempDevVarsPath = path.join(projectDir, `.dev.vars.${TEMP_ENV_NAME}`)
	const forwardTo = `localhost:${wranglerPort}/billing/webhook`

	const baseDevVarsContents = await readFile(devVarsPath, `utf8`)
	const stripeProcess = spawnStripeListener({ forwardTo, projectDir })
	let wranglerProcess: ReturnType<typeof spawnWranglerDev> | undefined

	const cleanup = async () => {
		stripeProcess.kill()
		wranglerProcess?.kill()
		await rm(tempDevVarsPath, { force: true })
	}

	const exitSignal = async () => {
		await cleanup()
		process.exit(130)
	}
	process.on(`SIGINT`, () => {
		void exitSignal()
	})
	process.on(`SIGTERM`, () => {
		void exitSignal()
	})

	try {
		const webhookSecret = await waitForWebhookSecret(stripeProcess)
		await writeFile(
			tempDevVarsPath,
			injectWebhookSecret(baseDevVarsContents, webhookSecret),
		)

		wranglerProcess = spawnWranglerDev({ projectDir, wranglerArgs })
		const exitCode = await new Promise<number>((resolve, reject) => {
			wranglerProcess?.on(`exit`, (code) => {
				resolve(code ?? 0)
			})
			wranglerProcess?.on(`error`, reject)
		})
		await cleanup()
		return exitCode
	} catch (error) {
		await cleanup()
		throw error
	}
}

const thisFilePath = fileURLToPath(import.meta.url)
if (process.argv[1] && path.resolve(process.argv[1]) === thisFilePath) {
	process.exit(await main())
}
