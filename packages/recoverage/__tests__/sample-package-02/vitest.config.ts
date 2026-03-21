import type { UserProjectConfigExport } from "vitest/config"
import { defineConfig } from "vitest/config"

const config: UserProjectConfigExport = defineConfig({
	test: {
		globals: true,
		coverage: {
			reporter: [`text`, `json`],
			include: [`*.ts`],
			exclude: [`*.config.ts`, `*.test.ts`],
		},
	},
})

export default config
