#!/usr/bin/env bun

import { ArkErrors, type } from "arktype"

import { jsonSummaryFixture, reportFixture } from "../__tests__/report-fixture"

export default null

const ENV = type({
	RECOVERAGE_CLOUD_TOKEN: type(`string`),
})(import.meta.env)
if (ENV instanceof ArkErrors) throw ENV

await fetch(`http://localhost:8787/reporter/thingy`, {
	method: `PUT`,
	headers: {
		Authorization: `Bearer ${ENV.RECOVERAGE_CLOUD_TOKEN}`,
	},
	body: JSON.stringify({
		mapData: reportFixture,
		jsonSummary: jsonSummaryFixture,
	}),
})
