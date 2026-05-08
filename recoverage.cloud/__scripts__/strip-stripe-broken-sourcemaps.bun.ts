#!/usr/bin/env bun

import {
	readdir,
	readFile,
	realpath,
	rm,
	stat,
	writeFile,
} from "node:fs/promises"
import path from "node:path"

type SourceMapFile = {
	sourceRoot?: string
	sources?: string[]
}

type BrokenMap = {
	javaScriptFilePath: string
	mapFilePath: string
	missingSourceFilePaths: string[]
}

const SOURCE_MAP_COMMENT = /\n\/\/# sourceMappingURL=[^\n]+\n?$/u

async function exists(filePath: string): Promise<boolean> {
	try {
		await stat(filePath)
		return true
	} catch {
		return false
	}
}

async function findFiles(
	rootPath: string,
	predicate: (filePath: string) => boolean,
): Promise<string[]> {
	const results: string[] = []

	for (const entry of await readdir(rootPath, { withFileTypes: true })) {
		const entryPath = path.join(rootPath, entry.name)
		if (entry.isDirectory()) {
			results.push(...(await findFiles(entryPath, predicate)))
			continue
		}

		if (predicate(entryPath)) {
			results.push(entryPath)
		}
	}

	return results
}

function resolveSourceFilePath(
	mapFilePath: string,
	sourceRoot: string | undefined,
	source: string,
): string {
	const mapDirectory = path.dirname(mapFilePath)
	const sourceBasePath = sourceRoot
		? path.resolve(mapDirectory, sourceRoot)
		: mapDirectory
	return path.resolve(sourceBasePath, source)
}

async function findBrokenStripeSourceMaps(
	stripePackagePath: string,
): Promise<BrokenMap[]> {
	const mapFilePaths = await findFiles(
		stripePackagePath,
		(filePath) =>
			filePath.endsWith(`.js.map`) &&
			(filePath.includes(`${path.sep}esm${path.sep}`) ||
				filePath.includes(`${path.sep}cjs${path.sep}`)),
	)

	const brokenMaps: BrokenMap[] = []
	let foundReferencedSourceFile = false

	for (const mapFilePath of mapFilePaths) {
		const mapFile = JSON.parse(
			await readFile(mapFilePath, `utf8`),
		) as SourceMapFile
		const sources = mapFile.sources ?? []
		if (sources.length === 0) {
			continue
		}

		const referencedSourceFilePaths = sources.map((source) =>
			resolveSourceFilePath(mapFilePath, mapFile.sourceRoot, source),
		)
		const missingSourceFilePaths: string[] = []

		for (const referencedSourceFilePath of referencedSourceFilePaths) {
			if (await exists(referencedSourceFilePath)) {
				foundReferencedSourceFile = true
				continue
			}
			missingSourceFilePaths.push(referencedSourceFilePath)
		}

		if (missingSourceFilePaths.length > 0) {
			brokenMaps.push({
				javaScriptFilePath: mapFilePath.slice(0, -`.map`.length),
				mapFilePath,
				missingSourceFilePaths,
			})
		}
	}

	if (foundReferencedSourceFile) {
		throw new Error(
			[
				`Stripe appears to have started shipping source files referenced by its sourcemaps.`,
				`This workaround is now obsolete and should be removed instead of silently mutating node_modules.`,
			].join(` `),
		)
	}

	return brokenMaps
}

async function stripBrokenSourceMapComment(
	javaScriptFilePath: string,
	mapFilePath: string,
): Promise<void> {
	const originalJavaScript = await readFile(javaScriptFilePath, `utf8`)
	const expectedComment = `//# sourceMappingURL=${path.basename(mapFilePath)}`
	if (!originalJavaScript.includes(expectedComment)) {
		throw new Error(
			`Expected ${javaScriptFilePath} to reference ${path.basename(mapFilePath)}.`,
		)
	}

	const strippedJavaScript = originalJavaScript.replace(SOURCE_MAP_COMMENT, `\n`)
	if (strippedJavaScript === originalJavaScript) {
		throw new Error(
			`Failed to strip sourcemap comment from ${javaScriptFilePath}.`,
		)
	}

	await writeFile(javaScriptFilePath, strippedJavaScript)
}

async function main(): Promise<void> {
	const stripePackagePath = await realpath(
		path.resolve(import.meta.dir, `../node_modules/stripe`),
	)
	const brokenMaps = await findBrokenStripeSourceMaps(stripePackagePath)

	if (brokenMaps.length === 0) {
		console.log(
			`stripe sourcemap workaround: nothing to patch (already stripped or package layout changed)`,
		)
		return
	}

	for (const brokenMap of brokenMaps) {
		await stripBrokenSourceMapComment(
			brokenMap.javaScriptFilePath,
			brokenMap.mapFilePath,
		)
		await rm(brokenMap.mapFilePath)
	}

	console.log(
		`stripe sourcemap workaround: stripped ${brokenMaps.length} broken sourcemap references`,
	)
}

await main()
