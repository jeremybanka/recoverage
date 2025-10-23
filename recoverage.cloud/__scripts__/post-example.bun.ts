#!/usr/bin/env bun

import { ArkErrors, type } from "arktype"

import {
	istanbulReportFixture,
	jsonSummaryFixture,
} from "../__tests__/report-fixture"

export default null

const ENV = type({
	RECOVERAGE_CLOUD_TOKEN: type(`string`),
})(import.meta.env)
if (ENV instanceof ArkErrors) {
	console.error(ENV)
	throw new Error(`failed to parse env`)
}

await fetch(`http://localhost:8787/reporter/thingy`, {
	method: `PUT`,
	headers: {
		Authorization: `Bearer ${ENV.RECOVERAGE_CLOUD_TOKEN}`,
	},
	body: JSON.stringify({
		mapData: istanbulReportFixture,
		jsonSummary: jsonSummaryFixture,
	}),
})
