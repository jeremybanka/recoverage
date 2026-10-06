import { spawnSync } from "node:child_process"
import {
	cpSync,
	existsSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

// Replay the selected public assertions in a disposable source package. Older
// contracts install the package and build it in beforeAll. The fixture package
// exports and consumer type environment use source, and the legacy build
// bootstrap is omitted. Released behavioral assertions are retained.
const source = path.resolve(import.meta.dirname, `..`)
const directory = mkdtempSync(
	path.join(tmpdir(), `recoverage-source-contracts-`),
)
const packageDirectory = path.join(directory, `packages/recoverage`)

try {
	cpSync(source, packageDirectory, {
		recursive: true,
		filter: (file) =>
			![`node_modules`, `dist`, `.yalc`, `coverage`, `artifacts`].includes(
				path.basename(file),
			),
	})
	symlinkSync(
		path.join(source, `node_modules`),
		path.join(packageDirectory, `node_modules`),
		`dir`,
	)
	symlinkSync(
		path.resolve(source, `../../node_modules`),
		path.join(directory, `node_modules`),
		`dir`,
	)
	for (const file of [`package.json`, `tsconfig.json`]) {
		cpSync(path.resolve(source, `../..`, file), path.join(directory, file))
	}
	const manifestPath = path.join(packageDirectory, `package.json`)
	const manifest = JSON.parse(readFileSync(manifestPath, `utf8`))
	manifest.main = `./src/recoverage.ts`
	manifest.types = `./src/recoverage.ts`
	manifest.exports = {
		"./package.json": `./package.json`,
		".": { types: `./src/recoverage.ts`, import: `./src/recoverage.ts` },
		"./lib": {
			types: `./src/recoverage.lib.ts`,
			import: `./src/recoverage.lib.ts`,
		},
	}
	manifest.bin = { recoverage: `./src/recoverage.x.ts` }
	manifest.files = [`src`]
	// Source consumer type checks need the producer's ambient and dependency
	// types, rather than declarations emitted by a build.
	for (const name of [
		`@types/bun`,
		`@types/node`,
		`@types/istanbul-lib-coverage`,
		`@types/istanbul-lib-report`,
		`@types/istanbul-reports`,
	]) {
		manifest.dependencies[name] = manifest.devDependencies[name]
	}
	writeFileSync(manifestPath, JSON.stringify(manifest, null, 2))

	const legacy = path.join(packageDirectory, `__tests__/diff-coverage.test.ts`)
	if (existsSync(legacy)) {
		const text = readFileSync(legacy, `utf8`)
		const bootstrap =
			/\tconst build = spawn\(`bun`, \[`run`, `build`\], \{[\s\S]*?\texpect\(buildCode\)\.toBe\(0\)\n/
		if (text.includes(`const build = spawn`) && !bootstrap.test(text)) {
			throw new Error(
				`Unrecognized historical build bootstrap; source replay needs an explicit adapter.`,
			)
		}
		writeFileSync(
			legacy,
			text
				.replace(bootstrap, ``)
				.replace(
					`const install = await runScript(\`install\`)`,
					`const install = await runScript(\`install\`, \`--network-concurrency\`, \`8\`)`,
				),
		)
	}

	const consumer = path.join(packageDirectory, `__tests__/public/consumer`)
	if (existsSync(consumer)) {
		symlinkSync(
			path.join(source, `__tests__/public/consumer/node_modules`),
			path.join(consumer, `node_modules`),
			`dir`,
		)
		const consumerManifestPath = path.join(consumer, `package.json`)
		const consumerManifest = JSON.parse(
			readFileSync(consumerManifestPath, `utf8`),
		)
		for (const name of [`@types/bun`, `@types/node`]) {
			consumerManifest.devDependencies[name] = manifest.devDependencies[name]
		}
		writeFileSync(
			consumerManifestPath,
			JSON.stringify(consumerManifest, null, 2),
		)
		const configPath = path.join(consumer, `tsconfig.json`)
		const config = JSON.parse(readFileSync(configPath, `utf8`))
		config.compilerOptions.allowImportingTsExtensions = true
		config.compilerOptions.types = [`bun`, `node`]
		writeFileSync(configPath, JSON.stringify(config, null, 2))
	}
	const result = spawnSync(`bun`, [`run`, `test:public`], {
		cwd: packageDirectory,
		stdio: `inherit`,
		env: {
			...process.env,
			RECOVERAGE_CLOUD_TOKEN: ``,
			S3_ACCESS_KEY_ID: ``,
			S3_SECRET_ACCESS_KEY: ``,
		},
	})
	if (result.error) throw result.error
	if (result.status !== 0) process.exitCode = result.status ?? 1
} finally {
	rmSync(directory, { recursive: true, force: true })
}
