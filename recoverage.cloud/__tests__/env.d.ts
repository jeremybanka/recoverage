import "@cloudflare/vitest-plugin/types"

declare global {
	namespace Cloudflare {
		interface Env {
			COOKIE_SECRET: string
			TEST_MIGRATIONS: D1Migration[]
		}
	}
}
