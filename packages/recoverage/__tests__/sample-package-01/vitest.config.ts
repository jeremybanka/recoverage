import type { UserConfig } from "vite"
import { defineConfig } from "vitest/config"

const config: UserConfig = defineConfig({
	test: {
		globals: true,
		coverage: {
			reporter: [`text`, `json`],
		},
	},
})

export default config
