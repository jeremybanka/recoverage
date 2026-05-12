import { rm } from "node:fs/promises"
import { resolve } from "node:path"

const appRoot = resolve(import.meta.dir, `..`)
const localD1StateDirectory = resolve(appRoot, `.wrangler/state/v3/d1`)

if (!localD1StateDirectory.startsWith(appRoot + `/`)) {
	throw new Error(`Refusing to delete a path outside the app root.`)
}

try {
	await rm(localD1StateDirectory, { force: true, recursive: true })
	console.log(`Destroyed local D1 state at ${localD1StateDirectory}`)
} catch (error) {
	console.error(`Failed to destroy local D1 state at ${localD1StateDirectory}`)
	throw error
}
