import type { Options, UserConfig } from "tsdown"
import { defineConfig } from "tsdown"

const config: UserConfig = defineConfig({
	clean: true,
	dts: true,
	entry: [`src/recoverage.ts`, `src/recoverage.x.ts`, `src/recoverage.lib.ts`],
	format: [`esm`],
	external: [`bun`, `bun:sqlite`],
	outDir: `dist`,
	sourcemap: true,
	treeshake: true,
	tsconfig: `tsconfig.json`,
} satisfies Options)

export default config
