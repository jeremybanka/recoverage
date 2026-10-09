import { spawnSync } from "node:child_process"
import {
	cpSync,
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	symlinkSync,
	writeFileSync,
} from "node:fs"
import path from "node:path"

import type { CoverageMapData } from "istanbul-lib-coverage"
import { createCoverageMap } from "istanbul-lib-coverage"
import { createInstrumenter } from "istanbul-lib-instrument"
import { createContext } from "istanbul-lib-report"
import reports from "istanbul-reports"

export const repositoryRoot: string = path.resolve(
	import.meta.dirname,
	`../../..`,
)
export const packagePaths: readonly string[] = [
	`packages/recoverage`,
	`recoverage.cloud`,
]

// Keep local toolchain/certificate settings for subprocess installs, while
// ensuring fixture repositories never upload reports to a configured service.
export const localEnvironment: NodeJS.ProcessEnv = {
	...process.env,
	RECOVERAGE_CLOUD_TOKEN: ``,
	RECOVERAGE_CLOUD_URL: ``,
	S3_ACCESS_KEY_ID: ``,
	S3_SECRET_ACCESS_KEY: ``,
	S3_BUCKET: ``,
	S3_ENDPOINT: ``,
}

export function run(
	command: string[],
	cwd: string,
	env: NodeJS.ProcessEnv = localEnvironment,
): void {
	const result = spawnSync(command[0], command.slice(1), {
		cwd,
		env,
		stdio: `inherit`,
	})
	if (result.error) throw result.error
	if (result.status !== 0)
		throw new Error(
			`${command.join(` `)} failed (${result.status ?? result.signal})`,
		)
}

function reportDirectory(directory: string): string {
	const output = path.join(directory, `coverage`)
	mkdirSync(output, { recursive: true })
	return output
}

// Instrument before either runtime transpiles/builds the source. Source and
// bundled subprocesses then use identical statement IDs and source paths.
export function instrumentSources(
	source: string,
	destination: string,
): CoverageMapData {
	const coverage = createCoverageMap({})
	for (const name of readdirSync(source, {
		recursive: true,
		encoding: `utf8`,
	})) {
		if (!/\.(ts|tsx)$/.test(name) || name.endsWith(`.d.ts`)) continue
		const filename = path.join(source, name)
		const instrumenter = createInstrumenter({
			esModules: true,
			parserPlugins: name.endsWith(`.tsx`)
				? [`typescript`, `jsx`]
				: [`typescript`],
		})
		const code = instrumenter.instrumentSync(
			readFileSync(filename, `utf8`),
			filename,
		)
		coverage.addFileCoverage(instrumenter.lastFileCoverage())
		writeFileSync(
			path.join(destination, name),
			`// @ts-nocheck\nimport * as __recoverageFs from "node:fs";
if (process.env.RECOVERAGE_COUNTERS && !globalThis.__recoverageFlush) {
  globalThis.__recoverageFlush = true;
  const output = process.env.RECOVERAGE_COUNTERS + "/" + process.pid + "-" + Math.random() + ".json";
  process.on("exit", () => {
    __recoverageFs.writeFileSync(output, JSON.stringify(globalThis.__coverage__ || {}));
  });
}
${code.replace(/^#![^\n]*\n/, ``)}
`,
		)
	}
	return coverage.toJSON()
}

export function writeReports(data: CoverageMapData, directory: string): void {
	const coverageMap = createCoverageMap(data)
	if (coverageMap.files().length === 0)
		throw new Error(`Empty coverage report: ${directory}`)
	const context = createContext({ dir: directory, coverageMap })
	for (const reporter of [`json`, `json-summary`, `text-summary`] as const) {
		reports.create(reporter).execute(context)
	}
}

export function collectPackage(directory: string, scratch: string): void {
	const output = reportDirectory(directory)
	const mirrorRoot = path.join(scratch, `workspace`)
	const mirror = path.join(mirrorRoot, `packages/recoverage`)
	mkdirSync(mirrorRoot, { recursive: true })
	const targetRoot = path.resolve(directory, `../..`)
	for (const name of [`package.json`, `tsconfig.json`]) {
		cpSync(path.join(targetRoot, name), path.join(mirrorRoot, name))
	}
	cpSync(directory, mirror, {
		recursive: true,
		filter: (file) =>
			!path
				.relative(directory, file)
				.split(path.sep)
				.some((part) =>
					[`node_modules`, `coverage`, `dist`, `.turbo`].includes(part),
				),
	})
	// Copy symlinks, not their dependency trees; package imports retain the
	// dependencies installed for the revision being measured.
	symlinkSync(
		path.join(targetRoot, `node_modules`),
		path.join(mirrorRoot, `node_modules`),
		`dir`,
	)
	symlinkSync(
		path.join(directory, `node_modules`),
		path.join(mirror, `node_modules`),
		`dir`,
	)
	// Instrumentation changes inferred parameter defaults; declaration output is
	// checked by the ordinary build, not by this disposable runtime-only build.
	const manifestPath = path.join(mirror, `package.json`)
	const manifest = JSON.parse(readFileSync(manifestPath, `utf8`))
	manifest.scripts.build = manifest.scripts.build.replace(
		`tsdown`,
		`tsdown --no-dts`,
	)
	writeFileSync(manifestPath, JSON.stringify(manifest))
	const zero = instrumentSources(
		path.join(directory, `src`),
		path.join(mirror, `src`),
	)
	const counters = path.join(scratch, `counters`)
	mkdirSync(counters)
	run(
		[`node`, path.join(directory, `node_modules/vitest/vitest.mjs`), `run`],
		mirror,
		{
			...localEnvironment,
			RECOVERAGE_COUNTERS: counters,
		},
	)
	const raw = readdirSync(counters).filter((name) => name.endsWith(`.json`))
	if (raw.length === 0) throw new Error(`Tests produced no coverage counters`)
	const merged = createCoverageMap(zero)
	for (const name of raw)
		merged.merge(JSON.parse(readFileSync(path.join(counters, name), `utf8`)))
	// Catch a broken subprocess collector even if ordinary unit tests still pass.
	for (const name of [`recoverage.ts`, `recoverage.x.ts`, `git-status.ts`]) {
		if (
			merged.fileCoverageFor(path.join(directory, `src`, name)).toSummary()
				.statements.covered === 0
		) {
			throw new Error(`Bun subprocess coverage is missing for ${name}`)
		}
	}
	writeReports(merged.toJSON(), output)
}

export function collectCloud(directory: string): void {
	// Workers resolve Vitest from the revision's config, so the CLI and provider
	// must also come from that revision, even across Vitest major upgrades.
	const targetRoot = path.resolve(directory, `..`)
	const vitest = path.join(directory, `node_modules/vitest`)
	const provider = path.join(
		targetRoot,
		`node_modules/@vitest/coverage-istanbul`,
	)
	if (targetRoot !== repositoryRoot && !existsSync(provider)) {
		const installedProvider = path.join(
			targetRoot,
			`packages/recoverage/node_modules/@vitest/coverage-istanbul`,
		)
		if (existsSync(installedProvider)) {
			mkdirSync(path.dirname(provider), { recursive: true })
			symlinkSync(installedProvider, provider, `dir`)
		} else {
			// Revisions predating the coverage harness need an exact matching
			// provider added only to their disposable baseline checkout.
			const { version } = JSON.parse(
				readFileSync(path.join(vitest, `package.json`), `utf8`),
			)
			run(
				[
					`bun`,
					`add`,
					`--dev`,
					`--exact`,
					`@vitest/coverage-istanbul@${version}`,
				],
				targetRoot,
			)
		}
	}
	run(
		[
			`node`,
			path.join(vitest, `vitest.mjs`),
			`run`,
			`--coverage.enabled`,
			`--coverage.provider=istanbul`,
			`--coverage.include=src/**/*.{ts,tsx}`,
			`--coverage.exclude=src/**/*.gen.ts`,
			`--coverage.exclude=src/**/*.gen.tsx`,
			`--coverage.exclude=src/**/*.d.ts`,
			`--coverage.reporter=json`,
			`--coverage.reporter=json-summary`,
			`--coverage.reporter=text-summary`,
		],
		directory,
	)
	if (!existsSync(path.join(directory, `coverage/coverage-final.json`)))
		throw new Error(`Cloud coverage report is missing`)
}

export function normalizedCoverage(directory: string): CoverageMapData {
	const input = createCoverageMap(
		JSON.parse(
			readFileSync(path.join(directory, `coverage/coverage-final.json`), `utf8`),
		),
	)
	const output = createCoverageMap({})
	for (const filename of input.files()) {
		const relative = path.relative(directory, filename).split(path.sep).join(`/`)
		if (!relative.startsWith(`src/`))
			throw new Error(`Coverage outside source directory: ${filename}`)
		output.addFileCoverage({
			...input.fileCoverageFor(filename).data,
			path: relative,
		})
	}
	if (output.files().length === 0)
		throw new Error(`Empty coverage report: ${directory}`)
	return output.toJSON()
}
