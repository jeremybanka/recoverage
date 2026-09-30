import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

import { yalcGlobal } from "yalc"

const directory = path.resolve(import.meta.dirname, `..`)
const store = await mkdtemp(path.join(tmpdir(), `recoverage-yalc-`))
yalcGlobal.yalcStoreMainDir = store

afterEach(() => {
	process.chdir(directory)
})
afterAll(async () => {
	process.chdir(directory)
	await rm(store, { recursive: true, force: true })
})
