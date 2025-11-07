#!/usr/bin/env bun

import { type } from "arktype"
import { cli, help, noOptions, optional, options } from "comline"
import logger from "takua"

import * as Recoverage from "./recoverage.ts"

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

			type({ "defaultBranch?": `string` }),
			{
				defaultBranch: {
					flag: `b`,
					required: false,
					description: `The default branch for the repository (default: "main").`,
					example: `--defaultBranch=trunk`,
				},
			},
		),
		capture: noOptions(`capture the current state of your coverage.`),
		diff: options(
			`diff the current state of your coverage.`,
			type({ "defaultBranch?": `string` }),
			{
				defaultBranch: {
					flag: `b`,
					required: false,
					description: `The default branch for the repository (default: "main").`,
					example: `--defaultBranch=trunk`,
				},
			},
		),
		help: noOptions(`show this help text.`),
	},
})

const { inputs } = parse(process.argv)
switch (inputs.case) {
	case ``:
		{
			const captureCode = await Recoverage.capture()
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
			const captureCode = await Recoverage.capture()
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
	case `help`:
		console.log(help(parse.definition))
		break
}
