import type { UserConfig } from "vite"
import { defineConfig } from "vitest/config"

const config: UserConfig = defineConfig({
	test: { globals: true, include: [`__tests__/*.test.ts`] },
})

export default config
