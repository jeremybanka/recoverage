import type { SpawnSyncReturns } from "node:child_process"
import { spawnSync } from "node:child_process"
import {
	cpSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	realpathSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import path from "node:path"

import { expect } from "bun:test"

const source = path.resolve(import.meta.dirname, `../../..`)
const fixture = path.resolve(import.meta.dirname, `../consumer`)
const fixtureRequire = createRequire(path.join(fixture, `package.json`))

type Manifest = {
	name: string
	version: string
	bin: Record<string, string> | string
	dependencies?: Record<string, string>
	devDependencies?: Record<string, string>
}

function manifest(directory: string): Manifest {
	return JSON.parse(readFileSync(path.join(directory, `package.json`), `utf8`))
}

function executable(directory: string, name: string): string {
	const bin = manifest(directory).bin
	return path.join(directory, typeof bin === `string` ? bin : bin[name])
}

// Resolve declared dependencies through their package resolver. The consumer
// never imports a dependency from Recoverage's private node_modules layout.
function resolvePackage(name: string, from = fixtureRequire): string {
	try {
		return path.dirname(from.resolve(`${name}/package.json`))
	} catch {
		let directory = path.dirname(from.resolve(name))
		while (directory !== path.dirname(directory)) {
			if (
				existsSync(path.join(directory, `package.json`)) &&
				manifest(directory).name
			) {
				return directory
			}
			directory = path.dirname(directory)
		}
		throw new Error(`Cannot locate installed dependency ${name}.`)
	}
}

function linkDependency(directory: string, name: string, target: string): void {
	const destination = path.join(directory, `node_modules`, name)
	mkdirSync(path.dirname(destination), { recursive: true })
	symlinkSync(target, destination)
}

export function packCurrentPackage(): { directory: string; remove: () => void } {
	const directory = mkdtempSync(path.join(tmpdir(), `recoverage-packed-`))
	const packed = spawnSync(
		`npm`,
		[
			`pack`,
			`--ignore-scripts`,
			`--workspaces=false`,
			`--pack-destination`,
			directory,
		],
		{
			cwd: source,
			encoding: `utf8`,
			timeout: 30_000,
		},
	)
	expect(packed.status, packed.stderr).toBe(0)
	const archive = readdirSync(directory).find((file) => file.endsWith(`.tgz`))
	if (!archive) throw new Error(`npm pack did not produce a package archive.`)
	const extracted = spawnSync(
		`tar`,
		[`-xf`, path.join(directory, archive), `-C`, directory],
		{ encoding: `utf8` },
	)
	expect(extracted.status, extracted.stderr).toBe(0)
	return {
		directory: path.join(directory, `package`),
		remove: () => {
			rmSync(directory, { recursive: true, force: true })
		},
	}
}

export class Consumer {
	public readonly directory: string

	public constructor(currentPackage: string) {
		this.directory = mkdtempSync(path.join(tmpdir(), `recoverage-consumer-`))
		for (const file of [`package.json`, `tsconfig.json`, `consumer.ts`]) {
			cpSync(path.join(fixture, file), path.join(this.directory, file))
		}
		for (const name of Object.keys(manifest(fixture).devDependencies ?? {})) {
			if (name !== `recoverage` && name !== `recoverage-0-1-18`) {
				linkDependency(this.directory, name, resolvePackage(name))
			}
		}
		this.installPackage(`recoverage`, currentPackage, source)
		writeFileSync(
			path.join(this.directory, `.gitignore`),
			`*\n!example.ts\n!.gitignore\n`,
		)
		writeFileSync(
			path.join(this.directory, `example.ts`),
			`export const one = 1\nexport const two = 2\n`,
		)
		mkdirSync(path.join(this.directory, `coverage`))
		this.git(`init`, `--initial-branch=trunk`)
		this.git(`config`, `user.name`, `Recoverage contract`)
		this.git(`config`, `user.email`, `contract@example.com`)
		this.git(`add`, `.`)
		this.git(`commit`, `-m`, `baseline`)
	}

	private installPackage(
		name: string,
		contents: string,
		dependencySource: string,
	): void {
		const installed = path.join(this.directory, `node_modules`, name)
		cpSync(contents, installed, {
			recursive: true,
			filter: (file) => path.basename(file) !== `node_modules`,
		})
		const resolver = createRequire(path.join(dependencySource, `package.json`))
		for (const dependency of Object.keys(
			manifest(contents).dependencies ?? {},
		)) {
			linkDependency(installed, dependency, resolvePackage(dependency, resolver))
		}
	}

	public installDataProducer(): void {
		const released = resolvePackage(`recoverage-0-1-18`)
		// Fixture provenance, not a constraint on the package under test.
		if (realpathSync(released) === realpathSync(source)) {
			throw new Error(
				`The released data producer resolved to the current workspace.`,
			)
		}
		expect(manifest(released).version).toBe(`0.1.18`)
		this.installPackage(`recoverage-0-1-18`, released, released)
	}

	public run(command: string, args: string[]): SpawnSyncReturns<string> {
		const result = spawnSync(command, args, {
			cwd: this.directory,
			encoding: `utf8`,
			timeout: 20_000,
			env: {
				...process.env,
				CI: `false`,
				RECOVERAGE_CLOUD_TOKEN: ``,
				S3_ACCESS_KEY_ID: ``,
				S3_SECRET_ACCESS_KEY: ``,
				NO_COLOR: `1`,
			},
		})
		expect(result.error).toBeUndefined()
		return result
	}

	public git(...args: string[]): void {
		const result = this.run(`git`, args)
		expect(result.status, result.stderr).toBe(0)
	}

	public evaluate(script: string): void {
		const result = this.run(`bun`, [
			`--eval`,
			`import assert from 'node:assert/strict';\n${script}`,
		])
		expect(result.status, result.stderr).toBe(0)
	}

	public cli(...args: string[]): SpawnSyncReturns<string> {
		const installed = path.join(this.directory, `node_modules/recoverage`)
		return this.run(`bun`, [executable(installed, `recoverage`), ...args])
	}

	public compile(): void {
		const typescript = resolvePackage(`typescript`)
		const result = this.run(`node`, [
			executable(typescript, `tsc`),
			`--project`,
			`tsconfig.json`,
		])
		expect(result.status, result.stdout + result.stderr).toBe(0)
	}

	public coverage(hits: readonly [number, number]): void {
		const file = path.join(this.directory, `example.ts`)
		writeFileSync(
			path.join(this.directory, `coverage/coverage-final.json`),
			JSON.stringify({
				[file]: {
					path: file,
					statementMap: {
						0: { start: { line: 1, column: 0 }, end: { line: 1, column: 10 } },
						1: { start: { line: 2, column: 0 }, end: { line: 2, column: 10 } },
					},
					s: { 0: hits[0], 1: hits[1] },
					fnMap: {},
					f: {},
					branchMap: {},
					b: {},
				},
			}),
		)
	}

	public configure(value: string | { defaultBranch: unknown }): void {
		writeFileSync(
			path.join(this.directory, `recoverage.config.json`),
			typeof value === `string` ? value : JSON.stringify(value),
		)
	}

	public remove(): void {
		rmSync(this.directory, { recursive: true, force: true })
	}
}
