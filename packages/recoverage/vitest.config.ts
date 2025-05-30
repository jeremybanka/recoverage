import type { UserConfig } from "vite"
import tsconfigPaths from "vite-tsconfig-paths"
import { defineConfig } from "vitest/config"

const config: UserConfig = defineConfig({
	plugins: [tsconfigPaths()],
	test: { globals: true, include: [`__tests__/*.test.ts`] },
})

export default config
