import type { UserProjectConfigExport } from "vitest/config"
import { defineConfig } from "vitest/config"

const config: UserProjectConfigExport = defineConfig({
	test: {
		globals: true,
		coverage: {
			reporter: [`text`, `json`],
		},
	},
})

export default config
