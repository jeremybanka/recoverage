import { defineConfig } from "vitest/config"

const config = defineConfig({
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
