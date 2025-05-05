import type { Options, UserConfig, UserConfigFn } from "tsdown"
import { defineConfig } from "tsdown"

const config: UserConfig | UserConfigFn = defineConfig({
	clean: true,
	dts: true,
	entry: {
		recoverage: `src/recoverage.ts`,
		"recoverage.x": `src/recoverage.x.ts`,
		"recoverage.lib": `src/recoverage.lib.ts`,
	},
	format: [`esm`],
	external: [`bun`, `bun:sqlite`],
	outDir: `dist`,
	sourcemap: true,
	treeshake: true,
	tsconfig: `tsconfig.json`,
} satisfies Options)

export default config
