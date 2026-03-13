import "@cloudflare/vitest-pool-workers/types"

declare global {
	namespace Cloudflare {
		interface Env {
			TEST_MIGRATIONS: D1Migration[]
		}
	}
}
