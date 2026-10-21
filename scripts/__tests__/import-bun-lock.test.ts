import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

import { expect, test } from "bun:test"

import { prepareBunLockImport } from "../import-bun-lock.bun.ts"

test(`historical lock import preserves nested versions, aliases, integrity, and workspace policy`, () => {
	const root = mkdtempSync(path.join(tmpdir(), `bun-lock-import-`))
	try {
		const manifest = {
			name: `fixture`,
			workspaces: [`packages/*`],
			packageManager: `bun@1.4.3`,
			trustedDependencies: [`esbuild`],
			overrides: { dep: `1.0.0` },
		}
		writeFileSync(path.join(root, `package.json`), JSON.stringify(manifest))
		mkdirSync(path.join(root, `packages/local`), { recursive: true })
		writeFileSync(
			path.join(root, `packages/local/package.json`),
			JSON.stringify({ name: `local`, version: `1.0.0` }),
		)
		writeFileSync(
			path.join(root, `bun.lock`),
			JSON.stringify({
				workspaces: { "": {}, "packages/local": {} },
				packages: {
					dep: [
						`dep@1.0.0`,
						``,
						{ dependencies: { nested: `^2.0.0` } },
						`sha512-original`,
					],
					"dep/nested": [`nested@2.0.1`, ``, {}, `sha512-nested`],
					alias: [`real@3.0.0`, ``, {}, `sha512-alias`],
					local: [`local@workspace:packages/local`],
				},
			}),
		)
		prepareBunLockImport(root)
		const lock = JSON.parse(
			readFileSync(path.join(root, `package-lock.json`), `utf8`),
		)
		expect(lock.packages[`node_modules/dep`].integrity).toBe(`sha512-original`)
		expect(lock.packages[`node_modules/dep/node_modules/nested`].version).toBe(
			`2.0.1`,
		)
		expect(lock.packages[`node_modules/alias`].name).toBe(`real`)
		expect(lock.packages[`node_modules/local`]).toEqual({
			resolved: `packages/local`,
			link: true,
		})
		const workspace = JSON.parse(
			readFileSync(path.join(root, `pnpm-workspace.yaml`), `utf8`),
		)
		expect(workspace).toEqual({
			packages: [`packages/*`],
			autoInstallPeers: false,
			allowBuilds: { "core-js": false, esbuild: true },
			overrides: { dep: `1.0.0` },
		})
		expect(
			JSON.parse(readFileSync(path.join(root, `package.json`), `utf8`))
				.packageManager,
		).toBe(`pnpm@12.14.0`)
	} finally {
		rmSync(root, { recursive: true, force: true })
	}
})
