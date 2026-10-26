import { changesetsReleaseDelta } from "@breakage/changesets"
import type { BreakageConfig } from "breakage"
import { defineConfig, semverPolicy } from "breakage"

const config: BreakageConfig = defineConfig({
	// Match only this package's stable releases, including annotated tags.
	tagPattern: `\\trefs/tags/recoverage@(?:0|[1-9]\\d*)\\.(?:0|[1-9]\\d*)\\.(?:0|[1-9]\\d*)(?:\\^\\{\\})?$`,
	// Preserve the original integration contracts and their fixtures as well as
	// the expanded public suite. Paths are relative to this config's directory.
	testPattern: `__tests__/{diff-coverage.test.ts,sample-package-*/{**,.gitignore},public/**}`,
	test: `bun run test:public`,
	release: {
		resolveDelta: changesetsReleaseDelta(),
		policy: semverPolicy({ beforeV1: `minor` }),
	},
})

export default config
