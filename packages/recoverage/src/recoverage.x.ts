#!/usr/bin/env bun

import { execFile } from "node:child_process"
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
} from "comline"
import logger from "takua"

import * as Recoverage from "./recoverage.ts"

const exec = promisify(execFile)

function branchOptions(description: string) {
	return options(description, type({ "defaultBranch?": `string` }), {
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
	})
}

const parse = cli({
	cliName: `recoverage`,
	routes: optional({
		"": null,
		capture: null,
		diff: null,
		help: null,
	}),
	routeOptions: {
		"": branchOptions(`capture and diff the current state of your coverage.`),
		capture: branchOptions(`capture the current state of your coverage.`),
		diff: branchOptions(`diff the current state of your coverage.`),
		help: noOptions(`show this help text.`),
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
if (inputs.case === `help`) {
	console.log(help(parse.definition))
	console.log(
		`\nShell completion: recoverage completion install <bash|zsh|fish|nushell|carapace>`,
	)
	process.exit(0)
}

switch (inputs.case) {
	case ``:
		{
			const captureCode = await Recoverage.capture({
				defaultBranch: inputs.opts.defaultBranch ?? `main`,
			})
			if (captureCode === 1) {
				logger.chronicle?.logMarks()
				process.exit(1)
			}
			try {
				const diffCode = await Recoverage.diff(
					inputs.opts.defaultBranch ?? `main`,
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
			})
			if (captureCode === 1) {
				process.exit(1)
			}
		}
		break
	case `diff`:
		try {
			const diffCode = await Recoverage.diff(inputs.opts.defaultBranch ?? `main`)
			if (diffCode === 1) {
				process.exit(1)
			}
		} catch (thrown) {
			console.error(thrown)
		}
		break
}
