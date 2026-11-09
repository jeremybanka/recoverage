import {
	chmod,
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	rm,
	stat,
	symlink,
	utimes,
	writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

import { readCloudStore, updateCloudStore } from "../src/cloud-config.ts"

let directory: string
beforeEach(async () => {
	directory = await mkdtemp(path.join(tmpdir(), `recoverage-cloud-store-`))
	vi.stubEnv(`XDG_CONFIG_HOME`, directory)
})
afterEach(async () => {
	vi.unstubAllEnvs()
	await rm(directory, { recursive: true, force: true })
})

test(`releases the store lock when a mutation fails and preserves committed credentials`, async () => {
	await updateCloudStore((store) => {
		store.reporters[`existing`] = `keep.secret`
	})
	await expect(
		updateCloudStore((store) => {
			store.reporters[`existing`] = `discard.secret`
			throw new Error(`Operation failed`)
		}),
	).rejects.toThrow(`Operation failed`)
	expect((await readCloudStore()).reporters).toEqual({ existing: `keep.secret` })
	if (process.platform !== `win32`)
		await chmod(path.join(directory, `recoverage/cloud.json`), 0o644)
	await updateCloudStore((store) => {
		store.reporters[`another`] = `new.secret`
	})
	expect((await readCloudStore()).reporters).toEqual({
		existing: `keep.secret`,
		another: `new.secret`,
	})
	expect(await readdir(path.join(directory, `recoverage`))).toEqual([
		`cloud.json`,
	])
	if (process.platform !== `win32`)
		expect(
			(await stat(path.join(directory, `recoverage/cloud.json`))).mode & 0o777,
		).toBe(0o600)
})

test(`keeps corrupt stores intact, releases their locks, and permits a subsequent repair`, async () => {
	await mkdir(path.join(directory, `recoverage`))
	const destination = path.join(directory, `recoverage/cloud.json`)
	await writeFile(destination, `{invalid`)
	await expect(updateCloudStore(() => {})).rejects.toThrow()
	expect(await readFile(destination, `utf8`)).toBe(`{invalid`)
	expect(await readdir(path.dirname(destination))).toEqual([`cloud.json`])
	await writeFile(destination, JSON.stringify({ accounts: {}, reporters: {} }))
	await updateCloudStore((store) => {
		store.reporters[`repaired`] = `new.secret`
	})
	expect((await readCloudStore()).reporters[`repaired`]).toBe(`new.secret`)
})

test(`recovers an abandoned lock left by a terminated writer`, async () => {
	const lockPath = path.join(directory, `recoverage/cloud.json.lock`)
	await mkdir(lockPath, { recursive: true })
	const past = new Date(Date.now() - 60_000)
	await utimes(lockPath, past, past)
	await updateCloudStore((store) => {
		store.reporters[`recovered`] = `new.secret`
	})
	expect((await readCloudStore()).reporters[`recovered`]).toBe(`new.secret`)
})

test.skipIf(process.platform === `win32`)(
	`supports aliases of the config directory`,
	async () => {
		const alias = `${directory}-alias`
		await symlink(directory, alias, `dir`)
		try {
			await updateCloudStore((store) => {
				store.reporters[`original`] = `keep.secret`
			})
			vi.stubEnv(`XDG_CONFIG_HOME`, alias)
			await updateCloudStore((store) => {
				store.reporters[`alias`] = `new.secret`
			})
			expect((await readCloudStore()).reporters).toEqual({
				original: `keep.secret`,
				alias: `new.secret`,
			})
			expect(await readdir(path.join(directory, `recoverage`))).toEqual([
				`cloud.json`,
			])
		} finally {
			await rm(alias)
		}
	},
)
