import { spawnSync } from "node:child_process"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

const entry = path.resolve(import.meta.dirname, `../src/recoverage.x.ts`)
const coverageModule = path.resolve(import.meta.dirname, `../src/recoverage.ts`)
let directory: string
let preload: string

beforeEach(() => {
	directory = mkdtempSync(path.join(tmpdir(), `recoverage-cli-`))
	preload = path.join(directory, `mock-coverage.ts`)
	writeFileSync(
		preload,
		`import { mock } from "bun:test"
mock.module(${JSON.stringify(coverageModule)}, () => ({
  capture: async ({ defaultBranch = "main" } = {}) => {
    console.log(JSON.stringify({ capture: defaultBranch }))
    return Number(process.env.CAPTURE_EXIT ?? 0)
  },
  diff: async (defaultBranch = "main") => {
    console.log(JSON.stringify({ diff: defaultBranch }))
    return Number(process.env.DIFF_EXIT ?? 0)
  },
}))
`,
	)
})

afterEach(() => {
	rmSync(directory, { recursive: true, force: true })
})

function invoke(args: string[], mockCoverage = true, env = {}) {
	const result = spawnSync(
		`bun`,
		[...(mockCoverage ? [`--preload`, preload] : []), entry, ...args],
		{
			cwd: directory,
			env: { ...process.env, NO_COLOR: `1`, FORCE_COLOR: `0`, ...env },
			encoding: `utf8`,
			timeout: 10_000,
		},
	)
	expect(result.error).toBeUndefined()
	return result
}

describe(`CLI execution`, () => {
	for (const command of [[], [`capture`], [`diff`]]) {
		for (const flag of [`--default-branch`, `--defaultBranch`, `-b`]) {
			it(`forwards ${flag} on ${command[0] ?? `the combined command`}`, () => {
				const result = invoke([...command, flag, `trunk`])
				expect(result.status).toBe(0)
				expect(result.stderr).toBe(``)
				const calls = result.stdout
					.trim()
					.split(`\n`)
					.map((line) => JSON.parse(line))
				expect(calls).toEqual(
					command[0] === `capture`
						? [{ capture: `trunk` }]
						: command[0] === `diff`
							? [{ diff: `trunk` }]
							: [{ capture: `trunk` }, { diff: `trunk` }],
				)
			})
		}
	}

	it(`defaults both operations to main`, () => {
		const result = invoke([])
		expect(result.status).toBe(0)
		expect(
			result.stdout
				.trim()
				.split(`\n`)
				.map((line) => JSON.parse(line)),
		).toEqual([{ capture: `main` }, { diff: `main` }])
	})

	it.each([
		{ args: [], branch: `trunk` },
		{ args: [`--default-branch=release`], branch: `release` },
	])(
		`reads JSON configuration with CLI overrides: $args`,
		({ args, branch }) => {
			writeFileSync(
				path.join(directory, `recoverage.config.json`),
				JSON.stringify({ defaultBranch: `trunk` }),
			)
			const result = invoke(args)
			expect(result.status, result.stderr).toBe(0)
			expect(result.stderr).toBe(``)
			expect(
				result.stdout
					.trim()
					.split(`\n`)
					.map((line) => JSON.parse(line)),
			).toEqual([{ capture: branch }, { diff: branch }])
		},
	)

	it(`warns on stderr about a misspelled flag without changing success`, () => {
		const result = invoke([`diff`, `--defaultBrnach=trunk`])
		expect(result.status).toBe(0)
		expect(result.stderr).toContain(`--defaultBrnach`)
		expect(JSON.parse(result.stdout)).toEqual({ diff: `main` })
	})

	it(`warns about options ignored by help`, () => {
		const result = invoke([`help`, `--default-branch=trunk`], false)
		expect(result.status).toBe(0)
		expect(result.stderr).toContain(`--default-branch`)
		expect(result.stdout).toContain(`recoverage completion install`)
	})

	it(`stops before diff when capture fails`, () => {
		const result = invoke([`-b`, `trunk`], true, { CAPTURE_EXIT: `1` })
		expect(result.status).toBe(1)
		expect(JSON.parse(result.stdout)).toEqual({ capture: `trunk` })
	})

	it.each([{ command: [] }, { command: [`diff`] }])(
		`preserves coverage failure for $command`,
		({ command }) => {
			const result = invoke(command, true, { DIFF_EXIT: `1` })
			expect(result.status).toBe(1)
		},
	)
})

describe(`shell completion`, () => {
	it(`works outside Git without coverage or valid application config`, () => {
		writeFileSync(path.join(directory, `recoverage.config.json`), `{invalid`)
		try {
			const commands = invoke([`__completeNoDesc`, ``], false)
			expect(commands.status).toBe(0)
			expect(commands.stderr).toBe(``)
			expect(commands.stdout.split(`\n`)).toEqual(
				expect.arrayContaining([`capture`, `diff`, `help`, `completion`]),
			)
			const branches = invoke([`__completeNoDesc`, `diff`, `-b`, ``], false)
			expect(branches.status).toBe(0)
			expect(branches.stderr).toBe(``)
			expect(branches.stdout.trim()).toBe(`:4`)
		} finally {
			rmSync(path.join(directory, `recoverage.config.json`))
		}
	})

	it.each([`bash`, `zsh`, `fish`, `nushell`, `carapace`])(
		`generates a %s integration without starting coverage`,
		(target) => {
			const result = invoke([`completion`, target], false)
			expect(result.status).toBe(0)
			expect(result.stderr).toBe(``)
			expect(result.stdout).toContain(`recoverage`)
		},
	)

	it(`suggests local branches from the invocation directory and hides supplied options`, () => {
		for (const args of [
			[`init`, `--initial-branch=trunk`],
			[
				`-c`,
				`user.name=Test`,
				`-c`,
				`user.email=test@example.com`,
				`commit`,
				`--allow-empty`,
				`-m`,
				`initial`,
			],
			[`branch`, `topic/test`],
		]) {
			const git = spawnSync(`git`, args, { cwd: directory, encoding: `utf8` })
			expect(git.status, git.stderr).toBe(0)
		}
		for (const command of [[], [`capture`], [`diff`]]) {
			const result = invoke(
				[`__completeNoDesc`, ...command, `--default-branch`, `tr`],
				false,
			)
			expect(result.status).toBe(0)
			expect(result.stderr).toBe(``)
			expect(result.stdout.trim().split(`\n`)).toEqual([`trunk`, `:4`])
		}
		const inline = invoke(
			[`__completeNoDesc`, `diff`, `--defaultBranch=topic/`],
			false,
		)
		expect(inline.status).toBe(0)
		expect(inline.stdout.trim().split(`\n`)).toEqual([`topic/test`, `:4`])
		const options = invoke([`__completeNoDesc`, `diff`, `--default-`], false)
		expect(options.stdout).toContain(`--default-branch`)
		const supplied = invoke(
			[`__completeNoDesc`, `diff`, `-b`, `trunk`, `--`],
			false,
		)
		expect(supplied.stdout).not.toContain(`--default`)
	})
})
