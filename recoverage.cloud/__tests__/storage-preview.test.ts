import { storagePreviewOrigin } from "../__scripts__/storage-preview"

const production = {
	name: `recoverage-cloud`,
	d1_databases: [
		{ database_id: `production-db-id`, database_name: `production-db` },
	],
}
const preview = {
	name: `recoverage-billing-preview`,
	vars: { STRIPE_MODE: `test` },
	d1_databases: [{ database_id: `preview-db-id`, database_name: `preview-db` }],
}
const valid = `https://recoverage-billing-preview.example-account.workers.dev`

test(`storage probe accepts only the generated preview's canonical origin`, () => {
	expect(storagePreviewOrigin(valid, preview, production).origin).toBe(valid)
	expect(storagePreviewOrigin(`${valid}/`, preview, production).origin).toBe(
		valid,
	)
})

test.each([
	`https://recoverage.cloud`,
	`https://recoverage.cloud.`,
	`https://recoverage-cloud.example-account.workers.dev`,
	`${valid}.`,
	`${valid}:443`,
	`${valid}:8443`,
	`${valid}/reports`,
	`${valid}?probe=1`,
	`${valid}#probe`,
	`https://user:password@recoverage-billing-preview.example-account.workers.dev`,
	`http://recoverage-billing-preview.example-account.workers.dev`,
	`https://recoverage-billing-preview.extra.example-account.workers.dev`,
	`https://another-preview.example-account.workers.dev`,
	`https://recoverage-billing-preview.example-account.workers.dev.attacker.test`,
])(`storage probe refuses unsafe origin %s`, (origin) => {
	expect(() => storagePreviewOrigin(origin, preview, production)).toThrow()
})

test.each([
	{ ...preview, name: production.name },
	{ ...preview, vars: { STRIPE_MODE: `live` } },
	{ ...preview, vars: {} },
	{ ...preview, d1_databases: [] },
	{
		...preview,
		d1_databases: [
			{
				database_id: production.d1_databases[0]?.database_id,
				database_name: `preview-db`,
			},
		],
	},
	{
		...preview,
		d1_databases: [
			{
				database_id: `preview-db-id`,
				database_name: production.d1_databases[0]?.database_name,
			},
		],
	},
	{ ...preview, d1_databases: [{ database_id: `preview-db-id` }] },
	{
		...preview,
		d1_databases: [...preview.d1_databases, ...production.d1_databases],
	},
])(`storage probe refuses non-isolated preview configuration %#`, (config) => {
	expect(() => storagePreviewOrigin(valid, config, production)).toThrow()
})
