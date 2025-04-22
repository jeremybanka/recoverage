import type { Options } from "tsdown"
import { defineConfig } from "tsdown"

export const OPTIONS = {
	clean: true,
	dts: true,
	entry: [`src/recoverage.ts`, `src/recoverage.x.ts`, `src/recoverage.lib.ts`],
	format: [`esm`],
	external: [`bun`, `bun:sqlite`],
	outDir: `dist`,
	sourcemap: true,
	treeshake: true,
	tsconfig: `tsconfig.json`,
} satisfies Options

export default defineConfig(OPTIONS)
