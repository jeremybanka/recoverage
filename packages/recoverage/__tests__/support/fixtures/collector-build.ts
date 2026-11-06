import { copyFileSync, mkdirSync, readFileSync, rmSync } from "node:fs"

rmSync(`dist`, { recursive: true, force: true })
mkdirSync(`dist`)
const result = await Bun.build({
	entrypoints: [`src/recoverage.ts`],
	outdir: `dist`,
	target: `bun`,
})
if (!result.success) throw new Error(`build failed`)
// Model a clean runtime build that cannot emit declarations after instrumentation.
if (!readFileSync(`src/recoverage.ts`, `utf8`).includes(`__recoverageFs`)) {
	copyFileSync(`recoverage.d.ts`, `dist/recoverage.d.ts`)
}
