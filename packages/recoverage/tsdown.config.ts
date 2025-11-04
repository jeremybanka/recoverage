import type { InlineConfig, UserConfig } from "tsdown"
import { defineConfig } from "tsdown"

const config: UserConfig = defineConfig({
	clean: true,
	dts: true,
	entry: {
		recoverage: `src/recoverage.ts`,
		"recoverage.x": `src/recoverage.x.ts`,
		"recoverage.lib": `src/recoverage.lib.ts`,
	},
	fixedExtension: false,
	format: `esm`,
	external: [`bun`, `bun:sqlite`],
	outDir: `dist`,
	platform: `node`,
	sourcemap: true,
	treeshake: true,
	tsconfig: `tsconfig.json`,
} satisfies InlineConfig)

export default config
