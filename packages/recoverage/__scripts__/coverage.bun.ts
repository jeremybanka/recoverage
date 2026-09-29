import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

import { collectCloud, collectPackage } from "./coverage-tools.ts"

const directory = path.resolve(process.argv[2] ?? process.cwd())
const scratch = mkdtempSync(path.join(tmpdir(), `recoverage-cov-`))
try {
	if (path.basename(directory) === `recoverage.cloud`) collectCloud(directory)
	else collectPackage(directory, scratch)
} finally {
	rmSync(scratch, { recursive: true, force: true })
}
