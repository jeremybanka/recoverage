import type { KnipConfig } from "knip"

// Public source entrypoints remain roots, including CLIs, workers, and conditional exports.
// Formatter plugins and JSON schemas are loaded by configuration paths, not imports.
// Fixture source is an executable test input and can keep development dependencies live.
// Generated distributions are checked through their authored source entrypoints.
export default {
	workspaces: {
		".": {
			entry: ["correctly.config.ts", "scripts/*.{ts,tsx}", "eslint.config.ts"],
			project: ["*.{ts,tsx,js,cjs,mjs}", "scripts/**/*.{ts,tsx,js,cjs,mjs}"],
			ignoreDependencies: [
				"@dprint/biome",
				"@dprint/markdown",
				"@changesets/config",
			],
		},
		"packages/fixtures": {
			entry: ["index.ts!"],
			project: [
				"*.{ts,tsx,js,cjs,mjs}",
				"{src,bin}/**/*.{ts,tsx,js,cjs,mjs}!",
				"{tests,__tests__,__scripts__,examples,docs,__exhibits__}/**/*.{ts,tsx,js,cjs,mjs}",
			],
		},
		"packages/recoverage": {
			entry: [
				"src/recoverage.ts!",
				"src/recoverage.lib.ts!",
				"bin/recoverage.bin.js!",
				"src/recoverage.x.ts!",
				"tsdown.config.ts",
				"breakage.config.ts",
				"vitest.config.ts",
				"__tests__/sample-package-*/**/*.{ts,tsx}",
				"__scripts__/**/*.{ts,tsx,js,mjs,cjs}",
			],
			project: [
				"*.{ts,tsx,js,cjs,mjs}",
				"{src,bin}/**/*.{ts,tsx,js,cjs,mjs}!",
				"{tests,__tests__,__scripts__,examples,docs,__exhibits__}/**/*.{ts,tsx,js,cjs,mjs}",
				"__scripts__/**/*.{ts,tsx,js,mjs,cjs}",
			],
		},
		"recoverage.cloud": {
			entry: [
				"src/index.tsx!",
				"drizzle.config.ts",
				"vitest.config.ts",
				"__scripts__/*.{ts,tsx}",
				"__tests__/report-fixture.ts",
				"__scripts__/**/*.{ts,tsx,js,mjs,cjs}",
			],
			project: [
				"*.{ts,tsx,js,cjs,mjs}",
				"{src,bin}/**/*.{ts,tsx,js,cjs,mjs}!",
				"{tests,__tests__,__scripts__,examples,docs,__exhibits__}/**/*.{ts,tsx,js,cjs,mjs}",
				"__scripts__/**/*.{ts,tsx,js,mjs,cjs}",
			],
			ignoreUnresolved: [
				// Generated browser bundle imported by the Cloudflare app.
				"./scripts.gen",
			],
			ignoreDependencies: [
				// Bundled as a static browser asset by the build script.
				"htmx.org",
			],
		},
	},
	// rg is a contributor host tool.
	ignoreBinaries: ["rg"],
	// The public consumer fixture deliberately pins old and current package installations.
	ignoreWorkspaces: ["packages/recoverage/__tests__/public/consumer"],
	ignore: ["**/dist/**"],
} satisfies KnipConfig
