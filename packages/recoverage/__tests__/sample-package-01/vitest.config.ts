import { defineConfig } from "vitest/config"

const config = defineConfig({
	test: {
		globals: true,
		coverage: {
			reporter: [`text`, `json`],
		},
	},
})

export default config
