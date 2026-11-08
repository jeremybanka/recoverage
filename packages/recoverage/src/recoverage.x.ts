#!/usr/bin/env bun

import { execFile } from "node:child_process"
import path from "node:path"
import { promisify } from "node:util"

import { type } from "arktype"
import {
	cli,
	completionResponse,
	help,
	logWarnings,
	noOptions,
	optional,
	options,
	parseBooleanOption,
	required,
} from "comline"
import logger from "takua"

import { cloudProjectType } from "./cloud-config.ts"
import * as Recoverage from "./recoverage.ts"

const exec = promisify(execFile)

function branchOptions(description: string) {
	return options(
		description,
		type({ "defaultBranch?": `string`, "cloud?": cloudProjectType }),
		{
			cloud: { configOnly: true },
			defaultBranch: {
				flag: `b`,
				aliases: [`default-branch`],
				required: false,
				description: `The default branch for the repository (default: "main").`,
				example: `--default-branch=trunk`,
				completion: {
					repeatable: false,
					fileSystem: `none`,
					async provide({ signal }) {
						try {
							const { stdout } = await exec(
								`git`,
								[`for-each-ref`, `--format=%(refname:strip=2)`, `refs/heads/`],
								{ cwd: process.cwd(), signal, timeout: 1000 },
							)
							return stdout.trim().split(`\n`).filter(Boolean)
						} catch {
							return []
						}
					},
				},
			},
		},
	)
}

const commonCloudOptions = {
	host: {
		required: false,
		example: `--host=https://recoverage.cloud`,
		description: `Cloud service origin (default: https://recoverage.cloud).`,
	},
	json: {
		required: false,
		example: `--json`,
		parse: parseBooleanOption,
		description: `Print machine-readable JSON.`,
	},
}
const projectCloudOptions = {
	...commonCloudOptions,
	project: {
		required: false,
		example: `--project=PROJECT_ID`,
		description: `Project ID (defaults to this directory's cloud configuration).`,
	},
}
const cloudOptions = type({ "host?": `string`, "json?": `boolean` })
const projectOptions = type({
	"host?": `string`,
	"json?": `boolean`,
	"project?": `string`,
})

const parse = cli({
	cliName: `recoverage`,
	discoverConfigPath: (route: readonly string[]) =>
		route[0] === `cloud`
			? undefined
			: path.join(process.cwd(), `recoverage.config.json`),
	routes: optional({
		"": null,
		capture: null,
		diff: null,
		help: null,
		cloud: required({
			login: null,
			logout: null,
			init: null,
			status: null,
			token: required({
				create: required({ $name: null }),
				revoke: required({ $id: null }),
			}),
		}),
	}),
	routeOptions: {
		"": branchOptions(`capture and diff the current state of your coverage.`),
		capture: branchOptions(`capture the current state of your coverage.`),
		diff: branchOptions(`diff the current state of your coverage.`),
		help: noOptions(`show this help text.`),
		"cloud/login": options(
			`Log in with GitHub device authorization.`,
			type({ "host?": `string`, "json?": `boolean`, "noBrowser?": `boolean` }),
			{
				...commonCloudOptions,
				noBrowser: {
					required: false,
					example: `--no-browser`,
					aliases: [`no-browser`],
					parse: parseBooleanOption,
					description: `Print the login URL without opening a browser.`,
				},
			},
		),
		"cloud/logout": options(
			`Revoke this account credential and remove it locally.`,
			cloudOptions,
			commonCloudOptions,
		),
		"cloud/init": options(
			`Create or select a cloud project and configure this directory.`,
			type({
				"host?": `string`,
				"json?": `boolean`,
				"project?": `string`,
				"name?": `string`,
				"report?": `string`,
			}),
			{
				...projectCloudOptions,
				name: {
					required: false,
					example: `--name=my-project`,
					description: `Create a project with this name.`,
				},
				report: {
					required: false,
					example: `--report=my-package`,
					description: `Report name (defaults to the directory name).`,
				},
			},
		),
		"cloud/status": options(
			`Show your account, projects, reports, tokens, and quotas.`,
			projectOptions,
			projectCloudOptions,
		),
		"cloud/token/create/$name": options(
			`Create a project-scoped reporter token; its secret is shown once.`,
			projectOptions,
			projectCloudOptions,
		),
		"cloud/token/revoke/$id": options(
			`Revoke a reporter token by ID.`,
			projectOptions,
			projectCloudOptions,
		),
	},
})

const completion = await completionResponse(parse.definition, process.argv)
if (completion !== undefined) {
	await new Promise<void>((resolve) => {
		process.stdout.write(completion, () => {
			resolve()
		})
	})
	process.exit(0)
}

const { inputs, warnings } = parse(process.argv)
logWarnings(warnings)

switch (inputs.case) {
	case ``:
		{
			const captureCode = await Recoverage.capture({
				defaultBranch: inputs.opts.defaultBranch ?? `main`,
				...(inputs.opts.cloud ? { cloud: inputs.opts.cloud } : {}),
			})
			if (captureCode === 1) {
				logger.chronicle?.logMarks()
				process.exit(1)
			}
			try {
				const diffCode = await Recoverage.diff(
					inputs.opts.defaultBranch ?? `main`,
					false,
					inputs.opts.cloud,
				)
				logger.chronicle?.logMarks()
				if (diffCode === 1) {
					process.exit(1)
				}
			} catch (thrown) {
				logger.chronicle?.logMarks()
				console.error(thrown)
				process.exit(1)
			}
		}
		break
	case `capture`:
		{
			const captureCode = await Recoverage.capture({
				defaultBranch: inputs.opts.defaultBranch ?? `main`,
				...(inputs.opts.cloud ? { cloud: inputs.opts.cloud } : {}),
			})
			if (captureCode === 1) {
				process.exit(1)
			}
		}
		break
	case `diff`:
		try {
			const diffCode = await Recoverage.diff(
				inputs.opts.defaultBranch ?? `main`,
				false,
				inputs.opts.cloud,
			)
			if (diffCode === 1) {
				process.exit(1)
			}
		} catch (thrown) {
			console.error(thrown)
			process.exit(1)
		}
		break
	case `cloud/login`:
	case `cloud/logout`:
	case `cloud/init`:
	case `cloud/status`:
	case `cloud/token/create/$name`:
	case `cloud/token/revoke/$id`:
		try {
			const cloud = await import(`./cloud.ts`)
			switch (inputs.case) {
				case `cloud/login`:
					await cloud.cloudLogin(inputs.opts)
					break
				case `cloud/logout`:
					await cloud.cloudLogout(inputs.opts)
					break
				case `cloud/init`:
					await cloud.cloudInit(inputs.opts)
					break
				case `cloud/status`:
					await cloud.cloudStatus(inputs.opts)
					break
				case `cloud/token/create/$name`:
					await cloud.cloudToken(`create`, inputs.params.name, inputs.opts)
					break
				case `cloud/token/revoke/$id`:
					await cloud.cloudToken(`revoke`, inputs.params.id, inputs.opts)
					break
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error)
			console.error(
				inputs.opts.json ? JSON.stringify({ error: message }) : message,
			)
			process.exitCode = 1
		}
		break
	case `help`:
		console.log(help(parse.definition))
		console.log(
			`\nShell completion: recoverage completion install <bash|zsh|fish|nushell|carapace>`,
		)
		process.exit(0)
}
