import colors from "colors"
import * as Diff from "diff"
import logger from "takua"

export function logDiff(
	mainGitRef: string,
	currentGitRef: string,
	mainCoverageTextReport: string,
	currentCoverageTextReport: string,
): void {
	logger.chronicle?.mark(
		`coverage diff between ${mainGitRef} and ${currentGitRef}:`,
	)
	const coverageDiffLines = Diff.diffLines(
		mainCoverageTextReport,
		currentCoverageTextReport,
	)
	for (const chunk of coverageDiffLines) {
		const split = chunk.value.split(`\n`)
		const text = split
			.map((line, i) => {
				if (line.startsWith(`---`)) {
					return `--${line}`
				}
				if (line.startsWith(`File  `)) {
					return line.replace(`File`, `File  `)
				}
				if (i === split.length - 1) {
					return ``
				}
				if (chunk.added) {
					return colors.green(`+ ${line}`)
				}
				if (chunk.removed) {
					return colors.red(`- ${line}`)
				}
				return `  ${line}`
			})
			.join(`\n`)
		process.stdout.write(text)
	}
}
