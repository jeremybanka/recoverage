import { execFileSync, spawnSync } from "node:child_process"
import {
	closeSync,
	mkdirSync,
	mkdtempSync,
	openSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs"
import os from "node:os"
import path from "node:path"

import { expect, test } from "bun:test"

const repository = path.resolve(import.meta.dirname, `../..`)
const packagePath = `packages/recoverage`
const { scripts } = JSON.parse(
	readFileSync(path.join(repository, packagePath, `package.json`), `utf8`),
) as { scripts: Record<string, string> }

type Scenario = {
	name: string
	breaking?: boolean
	bump?: `major` | `minor` | `patch`
	marker?: boolean
	version?: string
	baseline?: string
	noContract?: boolean
	hiddenContract?: boolean
	noTag?: boolean
	failBuild?: boolean
	failCurrent?: boolean
	dirty?: boolean
	status: number
	message: string
}

const scenarios: Scenario[] = [
	{
		name: `compatible release`,
		status: 0,
		message: `No breaking changes were found`,
	},
	{
		name: `undocumented break`,
		breaking: true,
		status: 1,
		message: `Breaking changes require a breaking release`,
	},
	{
		name: `marked patch`,
		breaking: true,
		bump: `patch`,
		marker: true,
		status: 1,
		message: `Breaking changes require a breaking release`,
	},
	{
		name: `unmarked minor`,
		breaking: true,
		bump: `minor`,
		status: 1,
		message: `Breaking changes require a breaking release`,
	},
	{
		name: `marked minor`,
		breaking: true,
		bump: `minor`,
		marker: true,
		status: 0,
		message: `Breaking changes are covered by the breaking release`,
	},
	{
		name: `consumed marked minor`,
		breaking: true,
		version: `0.2.0`,
		marker: true,
		status: 0,
		message: `Breaking changes are covered by the breaking release`,
	},
	{
		name: `consumed unmarked minor`,
		breaking: true,
		version: `0.2.0`,
		status: 1,
		message: `Breaking changes require a breaking release`,
	},
	{
		name: `post-1.0 minor`,
		baseline: `1.2.3`,
		breaking: true,
		bump: `minor`,
		marker: true,
		status: 1,
		message: `Breaking changes require a breaking release`,
	},
	{
		name: `post-1.0 major`,
		baseline: `1.2.3`,
		breaking: true,
		bump: `major`,
		marker: true,
		status: 0,
		message: `Breaking changes are covered by the breaking release`,
	},
	{
		name: `failing current suite`,
		breaking: true,
		bump: `minor`,
		marker: true,
		failCurrent: true,
		status: 1,
		message: `1 fail`,
	},
	{
		name: `failing build`,
		breaking: true,
		bump: `minor`,
		marker: true,
		failBuild: true,
		status: 1,
		message: `build failed`,
	},
	{
		name: `fixtures-only baseline`,
		noContract: true,
		status: 2,
		message: `no executable public contracts`,
	},
	{
		name: `hidden-only baseline`,
		hiddenContract: true,
		status: 2,
		message: `no executable public contracts`,
	},
	{
		name: `missing release`,
		noTag: true,
		status: 2,
		message: `No tags found matching`,
	},
	{
		name: `dirty checkout`,
		dirty: true,
		status: 2,
		message: `git repository must be clean`,
	},
]

for (const scenario of scenarios) {
	test(`Breakage CLI: ${scenario.name}`, () => {
		const root = mkdtempSync(path.join(os.tmpdir(), `recoverage-breakage-`))
		const directory = path.join(root, packagePath)
		const write = (file: string, content: string): void => {
			const filename = path.join(root, file)
			mkdirSync(path.dirname(filename), { recursive: true })
			writeFileSync(filename, content)
		}
		const git = (...args: string[]): string =>
			execFileSync(`git`, args, {
				cwd: root,
				encoding: `utf8`,
				stdio: [`ignore`, `pipe`, `pipe`],
			})
		const baseline = scenario.baseline ?? `0.1.20`
		const manifest = (version = baseline): string =>
			JSON.stringify({
				name: `recoverage`,
				version,
				type: `module`,
				scripts: {
					build: scenario.failBuild ? `echo 'build failed' >&2; exit 1` : `true`,
					"test:public": `bun test __tests__/public`,
					"test:breakage": scripts[`test:breakage`],
				},
			})
		const contract = (value: number): string =>
			`import { test, expect } from 'bun:test'; import { value } from '../../api.ts'; test('public API', () => expect(value).toBe(${value}));\n`
		try {
			write(
				`package.json`,
				JSON.stringify({
					name: `breakage-fixture`,
					private: true,
					type: `module`,
					workspaces: [`packages/*`],
				}),
			)
			write(`.gitignore`, `node_modules\n`)
			// Workspace discovery uses the lockfile's presence; no install is needed.
			write(`bun.lock`, `{}`)
			write(
				`.changeset/config.json`,
				JSON.stringify({
					changelog: false,
					commit: false,
					fixed: [],
					linked: [],
					access: `public`,
					baseBranch: `main`,
					updateInternalDependencies: `patch`,
					ignore: [],
				}),
			)
			write(`${packagePath}/package.json`, manifest())
			write(`${packagePath}/CHANGELOG.md`, `# recoverage\n`)
			write(`${packagePath}/api.ts`, `export const value = 1;\n`)
			if (scenario.noContract || scenario.hiddenContract) {
				write(
					`${packagePath}/__tests__/public/helper.ts`,
					`export const fixture = 1;\n`,
				)
				if (scenario.hiddenContract)
					write(`${packagePath}/__tests__/public/.hidden.test.ts`, contract(1))
			} else {
				write(`${packagePath}/__tests__/public/package.test.ts`, contract(1))
			}
			for (const file of [
				`${packagePath}/breakage.config.ts`,
				`${packagePath}/__scripts__/breakage-release.ts`,
				`scripts/release-compatibility.ts`,
			])
				write(file, readFileSync(path.join(repository, file), `utf8`))
			for (const base of [``, packagePath]) {
				symlinkSync(
					path.join(repository, base, `node_modules`),
					path.join(root, base, `node_modules`),
					`dir`,
				)
			}
			git(`init`, `-b`, `main`)
			git(`config`, `user.name`, `Breakage fixture`)
			git(`config`, `user.email`, `fixture@example.invalid`)
			git(`config`, `commit.gpgsign`, `false`)
			git(`add`, `.`)
			git(`commit`, `-m`, `baseline`)
			if (!scenario.noTag) git(`tag`, `recoverage@${baseline}`)
			// All tag discovery and fetching stay inside this disposable repository.
			git(`remote`, `add`, `origin`, root)
			if (scenario.breaking)
				write(`${packagePath}/api.ts`, `export const value = 2;\n`)
			write(
				`${packagePath}/__tests__/public/package.test.ts`,
				contract(scenario.breaking && !scenario.failCurrent ? 2 : 1),
			)
			const note = `${scenario.marker ? `💥 BREAKING CHANGE:` : `Feature:`} Update the API.`
			if (scenario.bump)
				write(
					`.changeset/review-note.md`,
					`---\n"recoverage": ${scenario.bump}\n---\n\n${note}\n`,
				)
			if (scenario.version) {
				write(`${packagePath}/package.json`, manifest(scenario.version))
				write(
					`${packagePath}/CHANGELOG.md`,
					`# recoverage\n\n## ${scenario.version}\n\n${note}\n`,
				)
			}
			git(`add`, `.`)
			git(`commit`, `--allow-empty`, `-m`, `candidate`)
			if (scenario.dirty) write(`uncommitted.txt`, `Preserve this edit.\n`)
			const before = git(`status`, `--porcelain`)
			const outputFile = path.join(root, `.git/cli-output.log`)
			const outputFd = openSync(outputFile, `w`)
			const result = spawnSync(process.execPath, [`run`, `test:breakage`], {
				cwd: directory,
				encoding: `utf8`,
				timeout: 20_000,
				stdio: [`ignore`, outputFd, outputFd],
			})
			closeSync(outputFd)
			const output = readFileSync(outputFile, `utf8`)
			expect(result.error).toBeUndefined()
			expect(output).toContain(scenario.message)
			expect(result.status).toBe(scenario.status)
			expect(git(`status`, `--porcelain`)).toBe(before)
			if (scenario.failBuild || scenario.failCurrent)
				expect(output).not.toContain(`Release:`)
		} finally {
			rmSync(root, { recursive: true, force: true })
		}
	}, 30_000)
}
