import { readFileSync, writeFileSync } from "node:fs"
import path from "node:path"

type PackageMetadata = {
	dependencies?: Record<string, string>
	optionalDependencies?: Record<string, string>
	peerDependencies?: Record<string, string>
	os?: string[] | string
	cpu?: string[] | string
}
type BunLock = {
	workspaces: Record<string, unknown>
	packages: Record<string, [string, ...unknown[]]>
}

/** Convert an archived Bun graph offline so pnpm can import its exact resolutions. */
export function prepareBunLockImport(root: string): void {
	const manifestPath = path.join(root, `package.json`)
	const manifest = JSON.parse(readFileSync(manifestPath, `utf8`))
	const lock = Bun.JSON5.parse(
		readFileSync(path.join(root, `bun.lock`), `utf8`),
	) as BunLock
	const packages: Record<string, unknown> = {}
	for (const location of Object.keys(lock.workspaces)) {
		packages[location] = JSON.parse(
			readFileSync(path.join(root, location, `package.json`), `utf8`),
		)
	}
	for (const [key, entry] of Object.entries(lock.packages)) {
		const specifier = entry[0]
		const split = specifier.lastIndexOf(`@`)
		const name = specifier.slice(0, split)
		const version = specifier.slice(split + 1)
		const parts = key.match(/@[^/]+\/[^/]+|[^/]+/g)
		if (!parts) throw new Error(`Invalid locked package path: ${key}`)
		const location = parts.map((part) => `node_modules/${part}`).join(`/`)
		if (version.startsWith(`workspace:`)) {
			packages[location] = { resolved: version.slice(10), link: true }
			continue
		}
		const metadata = (entry.find(
			(item) => typeof item === `object` && item !== null,
		) ?? {}) as PackageMetadata
		const integrity = entry.find(
			(item) => typeof item === `string` && item.startsWith(`sha`),
		)
		const tarball = version.startsWith(`https:`)
		const actualVersion = tarball
			? /-([\d]+\.[\d]+\.[^/]+)\.tgz$/.exec(version)?.[1]
			: version
		if (!actualVersion || (!tarball && !/^\d+\.\d+\./.test(version))) {
			throw new Error(`Unsupported Bun lock resolution: ${specifier}`)
		}
		packages[location] = {
			name,
			version: actualVersion,
			resolved: tarball
				? version
				: `https://registry.npmjs.org/${name}/-/${name.split(`/`).at(-1)}-${version}.tgz`,
			integrity,
			...metadata,
			...(metadata.os && { os: [metadata.os].flat() }),
			...(metadata.cpu && { cpu: [metadata.cpu].flat() }),
		}
	}
	writeFileSync(
		path.join(root, `package-lock.json`),
		JSON.stringify({
			name: manifest.name,
			lockfileVersion: 3,
			requires: true,
			packages,
		}),
	)
	writeFileSync(
		path.join(root, `pnpm-workspace.yaml`),
		JSON.stringify({
			packages: manifest.workspaces,
			autoInstallPeers: false,
			allowBuilds: {
				"core-js": false,
				...Object.fromEntries(
					(manifest.trustedDependencies ?? []).map((name: string) => [
						name,
						true,
					]),
				),
			},
			overrides: manifest.overrides ?? {},
		}),
	)
	manifest.packageManager = `pnpm@12.15.0`
	delete manifest.workspaces
	delete manifest.trustedDependencies
	delete manifest.overrides
	writeFileSync(manifestPath, JSON.stringify(manifest))
}
