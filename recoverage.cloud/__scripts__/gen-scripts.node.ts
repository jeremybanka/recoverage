#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises"
import path from "node:path"

const htmxMinJs = await readFile(
	`node_modules/htmx.org/dist/htmx.min.js`,
	`utf8`,
)

await writeFile(
	path.join(import.meta.dirname, `../src/scripts.gen.ts`),
	`/* eslint-disable */\nexport const htmxMinJS = ${JSON.stringify(
		JSON.stringify(htmxMinJs),
	)};\n`,
)
