import path from "node:path"

import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin"
import { defineConfig } from "vitest/config"

export default defineConfig(async () => {
	const migrationsPath = path.join(import.meta.dirname, `drizzle`)
	const migrations = await readD1Migrations(migrationsPath)

	return {
		plugins: [
			cloudflareTest({
				main: `./src/index.tsx`,
				wrangler: {
					configPath: `./wrangler.jsonc`,
				},
				miniflare: {
					bindings: {
						TEST_MIGRATIONS: migrations,
						COOKIE_SECRET: `HI`,
						GITHUB_CLIENT_ID: `test-client-id`,
						GITHUB_CLIENT_SECRET: `test-client-secret`,
					},
				},
			}),
		],
		test: {
			setupFiles: [
				`./__tests__/apply-migrations.ts`,
				`./__tests__/hack-process-version.ts`,
			],
			globals: true,
		},
	}
})
