import { mock } from "bun:test"

await mock.module(`../../src/recoverage.ts`, () => ({
	capture: ({ defaultBranch = `main` }: { defaultBranch?: string } = {}) => {
		console.log(JSON.stringify({ capture: defaultBranch }))
		return Promise.resolve(Number(process.env[`CAPTURE_EXIT`] ?? 0))
	},
	diff: (defaultBranch = `main`) => {
		console.log(JSON.stringify({ diff: defaultBranch }))
		if (process.env[`DIFF_THROW`])
			return Promise.reject(new Error(process.env[`DIFF_THROW`]))
		return Promise.resolve(Number(process.env[`DIFF_EXIT`] ?? 0))
	},
}))
