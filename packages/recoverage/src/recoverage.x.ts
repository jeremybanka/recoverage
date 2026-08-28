#!/usr/bin/env bun

import { type } from "arktype"
import { cli, help, noOptions, optional, options } from "comline"
import logger from "takua"

import * as Recoverage from "./recoverage.ts"

const defaultBranchOption = {
	flag: `b`,
	required: false,
	description: `The default branch for the repository (default: "main").`,
	example: `--defaultBranch=trunk`,
} as const

const reportNameOption = {
	flag: `r`,
	required: false,
	description: `The report name to use on recoverage.cloud (default: current directory name).`,
	example: `--reportName=my-package`,
} as const

function toRecoverageOptions(opts: {
	defaultBranch?: string
	reportName?: string
}): Recoverage.RecoverageOptions {
	return {
		defaultBranch: opts.defaultBranch ?? `main`,
		...(opts.reportName ? { reportName: opts.reportName } : {}),
	}
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
		"": options(
			`capture and diff the current state of your coverage.`,

			type({ "defaultBranch?": `string`, "reportName?": `string` }),
			{
				defaultBranch: defaultBranchOption,
				reportName: reportNameOption,
			},
		),
		capture: options(
			`capture the current state of your coverage.`,
			type({ "defaultBranch?": `string`, "reportName?": `string` }),
			{
				defaultBranch: defaultBranchOption,
				reportName: reportNameOption,
			},
		),
		diff: options(
			`diff the current state of your coverage.`,
			type({ "defaultBranch?": `string`, "reportName?": `string` }),
			{
				defaultBranch: defaultBranchOption,
				reportName: reportNameOption,
			},
		),
		help: noOptions(`show this help text.`),
	},
})

const { inputs } = parse(process.argv)
switch (inputs.case) {
	case ``:
		{
			const recoverageOptions = toRecoverageOptions(inputs.opts)
			const captureCode = await Recoverage.capture(recoverageOptions)
			if (captureCode === 1) {
				logger.chronicle?.logMarks()
				process.exit(1)
			}
			try {
				const diffCode = await Recoverage.diff(recoverageOptions)
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
			const captureCode = await Recoverage.capture(
				toRecoverageOptions(inputs.opts),
			)
			if (captureCode === 1) {
				process.exit(1)
			}
		}
		break
	case `diff`:
		try {
			const diffCode = await Recoverage.diff(toRecoverageOptions(inputs.opts))
			if (diffCode === 1) {
				process.exit(1)
			}
		} catch (thrown) {
			console.error(thrown)
		}
		break
	case `help`:
		console.log(help(parse.definition))
		break
}
