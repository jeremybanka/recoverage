import "@cloudflare/vitest-plugin/types"

declare global {
	namespace Cloudflare {
		interface Env {
			TEST_MIGRATIONS: D1Migration[]
			COOKIE_SECRET: string
			GITHUB_CLIENT_ID: string
			GITHUB_CLIENT_SECRET: string
		}
	}
}
