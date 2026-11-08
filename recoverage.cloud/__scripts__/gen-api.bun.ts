import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

import { build } from "tsdown"

const root = path.resolve(import.meta.dirname, `..`)
const destination = path.resolve(
	root,
	`../packages/recoverage/src/cloud-api.gen.d.ts`,
)
const directory = await mkdtemp(path.join(tmpdir(), `recoverage-rpc-`))
try {
	await build({
		config: false,
		cwd: root,
		entry: { "api-contract": `src/api-contract.ts` },
		tsconfig: path.join(root, `tsconfig.api.json`),
		outDir: directory,
		format: `esm`,
		fixedExtension: false,
		dts: { dtsOnly: true },
		logLevel: `silent`,
	})
	const declaration = `// Generated from recoverage.cloud/src/api.ts. Run bun run --cwd recoverage.cloud gen:api.\n${await readFile(path.join(directory, `api-contract.d.ts`), `utf8`)}\n`
	// Declaration emit can reorder equivalent unions. Compare the inferred RPC
	// clients semantically so output ordering cannot cause false stale checks.
	await symlink(
		path.join(root, `node_modules`),
		path.join(directory, `node_modules`),
		`dir`,
	)
	await writeFile(
		path.join(directory, `check.ts`),
		`
import { hc } from "hono/client"
import type { apiContract as current } from "./api-contract.d.ts"
import type { apiContract as saved } from ${JSON.stringify(destination)}
type Current = ReturnType<typeof hc<typeof current>>
type Saved = ReturnType<typeof hc<typeof saved>>
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false
const sameContract: Equal<Current, Saved> = true
`,
	)
	const config = path.join(directory, `tsconfig.json`)
	await writeFile(
		config,
		JSON.stringify({
			compilerOptions: {
				strict: true,
				noEmit: true,
				skipLibCheck: true,
				module: `ESNext`,
				moduleResolution: `Bundler`,
				allowImportingTsExtensions: true,
				types: [],
			},
			files: [`check.ts`],
		}),
	)
	const comparison = Bun.spawnSync(
		[process.execPath, `--check`, `--tsconfig-override`, config],
		{ cwd: directory, stdout: `pipe`, stderr: `pipe` },
	)
	const matches = comparison.exitCode === 0
	if (process.argv.includes(`--check`)) {
		if (!matches) {
			throw new Error(
				`Cloud RPC contract is stale. Run bun run --cwd recoverage.cloud gen:api and commit the updated declaration.`,
			)
		}
	} else if (!matches) {
		await writeFile(destination, declaration)
	}
} finally {
	await rm(directory, { recursive: true, force: true })
}
