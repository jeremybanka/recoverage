import { schemars } from "@correctlyjs/schemars/ajv"
import { defineConfig, GITIGNORE, json, jsonc, toml, yaml } from "correctly"
import { renovate } from "correctly/extensions/renovate"
import { ajv } from "correctly/validators/ajv"

export default defineConfig({
	remote: { maxBytes: 8 * 1024 * 1024 },
	exclude: [GITIGNORE, "**/pnpm-lock.yaml", "**/bun.lock", "**/fixtures/**"],
	associations: [
		{
			name: "Changesets",
			files: [".changeset/config.json"],
			parse: json(),
			validate: ajv({ schema: "node_modules/@changesets/config/schema.json" }),
		},
		{
			name: "Dprint",
			files: ["**/dprint.json"],
			parse: json(),
			packages: ["@dprint/biome", "@dprint/markdown", "dprint"],
			validate: ajv({ schema: "https://dprint.dev/schemas/v0.json" }),
		},
		{
			name: "Turbo",
			files: ["turbo.json"],
			parse: json(),
			validate: ajv({
				schema: "node_modules/turbo/schema.json",
				extensions: [schemars({ version: "0.8.22" })],
			}),
		},
		{
			name: "Renovate",
			files: ["renovate.json"],
			parse: json(),
			validate: ajv({
				// Initial snapshot matches atom.io: renovate@44.148.4, before the
				// upstream installTools schema regression. Refresh Renovate explicitly.
				// https://unpkg.com/renovate@44.148.4/renovate-schema.json
				schema: "https://docs.renovatebot.com/renovate-schema.json",
				extensions: [renovate()],
			}),
		},
		{
			name: "Biome",
			files: ["**/biome.json", "**/biome.jsonc"],
			parse: jsonc(),
			validate: ajv({
				schema: "node_modules/@biomejs/biome/configuration_schema.json",
				extensions: [schemars({ version: "1.2.2" })],
			}),
		},
		{
			name: "Wrangler",
			files: ["recoverage.cloud/wrangler.jsonc"],
			parse: jsonc(),
			validate: ajv({
				schema: "recoverage.cloud/node_modules/wrangler/config-schema.json",
			}),
		},
		{
			name: "TypeScript and editor settings",
			files: ["**/tsconfig*.json", "**/.vscode/*.json", "**/.zed/*.json"],
			parse: jsonc(),
			validate: null,
		},
		{
			name: "GitHub workflows",
			files: [".github/workflows/*.{yml,yaml}"],
			parse: yaml(),
			validate: ajv({
				schema: "https://www.schemastore.org/github-workflow.json",
			}),
		},
		{
			name: "GitHub actions",
			files: [".github/actions/**/action.{yml,yaml}"],
			parse: yaml(),
			validate: ajv({
				schema: "https://www.schemastore.org/github-action.json",
			}),
		},
		{
			name: "Mise",
			files: ["**/mise.toml"],
			parse: toml(),
			validate: ajv({ schema: "https://mise.jdx.dev/schema/mise.json" }),
		},
	],
})
