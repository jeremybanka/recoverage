type WorkerConfig = {
	name?: string
	vars?: { STRIPE_MODE?: string }
	d1_databases?: { database_id?: string; database_name?: string }[]
}

export function storagePreviewOrigin(
	value: string,
	preview: WorkerConfig,
	production: WorkerConfig,
): URL {
	const origin = new URL(value)
	const previewDb = preview.d1_databases?.[0]
	const productionDb = production.d1_databases?.[0]
	const labels = origin.hostname.split(`.`)
	if (
		!preview.name ||
		!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(preview.name) ||
		!production.name ||
		preview.name === production.name ||
		preview.vars?.STRIPE_MODE !== `test` ||
		preview.d1_databases?.length !== 1 ||
		!previewDb?.database_id ||
		!previewDb.database_name ||
		!productionDb?.database_id ||
		!productionDb.database_name ||
		previewDb.database_id === productionDb.database_id ||
		previewDb.database_name === productionDb.database_name ||
		origin.protocol !== `https:` ||
		origin.username ||
		origin.password ||
		origin.port ||
		origin.pathname !== `/` ||
		origin.search ||
		origin.hash ||
		(value !== origin.origin && value !== `${origin.origin}/`) ||
		labels.length !== 4 ||
		labels[0] !== preview.name ||
		!labels[1] ||
		!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(labels[1]) ||
		labels[2] !== `workers` ||
		labels[3] !== `dev`
	) {
		throw new Error(
			`Storage verification requires an isolated test preview config and its canonical https://<preview-worker>.<account-subdomain>.workers.dev origin.`,
		)
	}
	return origin
}
