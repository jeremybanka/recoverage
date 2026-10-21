const reportFixture = {
	"/some/file.ts": {
		path: `/some/file.ts`,
		statementMap: {
			"1": {
				start: { line: 1, column: 1 },
				end: { line: 1, column: 1 },
			},
		},
		branchMap: {
			"1": {
				loc: {
					start: { line: 1, column: 1 },
					end: { line: 1, column: 1 },
				},
				line: 1,
				type: `if`,
				locations: [
					{
						start: { line: 1, column: 1 },
						end: { line: 1, column: 1 },
					},
				],
			},
		},
		fnMap: {
			"1": {
				line: 1,
				name: `test`,
				decl: {
					start: { line: 1, column: 1 },
					end: { line: 1, column: 1 },
				},
				loc: {
					start: { line: 1, column: 1 },
					end: { line: 1, column: 1 },
				},
			},
		},
		s: { "1": 1 },
		f: { "1": 1 },
		b: { "1": [1] },
	},
} satisfies CoverageMapData

import type { CoverageMapData } from "istanbul-lib-coverage"
import { createCoverageMap } from "istanbul-lib-coverage"
import { createContext } from "istanbul-lib-report"
import reports from "istanbul-reports"

import { VirtualFileWriter } from "../src/istanbul-writer.ts"

test(`coverage writer`, () => {
	const coverageMap = createCoverageMap(reportFixture)
	const context = createContext({
		coverageMap,
	})
	const writer = new VirtualFileWriter(`/`)
	context.data.writer = writer
	const report = reports.create(`text`, {
		file: `coverage.txt`,
	})
	report.execute(context)

	const output = writer.vfs.readFileSync(`coverage.txt`)
	expect(output).toContain(`file.ts`)
	expect(output).toMatch(/All files\s*\|\s*100\s*\|\s*100\s*\|\s*100\s*\|\s*100/)
	expect(output.endsWith(`\n`)).toBe(true)
})

describe(`virtual report files`, () => {
	it(`writes nested files and shares them with subdirectory writers`, () => {
		const writer = new VirtualFileWriter(`/reports`)
		const child = writer.writeForDir(`nested`)
		const file = child.writeFile(`coverage.txt`)
		file.write(`first`)
		file.println(` line`)
		file.println(file.colorize(`second line`))
		file.close()
		expect(writer.vfs.readFileSync(`/reports/nested/coverage.txt`)).toBe(
			`first line\nsecond line\n`,
		)
		expect(() => {
			file.write(`closed`)
		}).toThrow(`Bad file descriptor`)
	})

	it.each([undefined, `generated\n`])(
		`copies files with header %s`,
		(header) => {
			const writer = new VirtualFileWriter(`/reports`)
			writer.vfs.writeFileSync(`/source/nested/input.txt`, `contents`)
			writer.copyFile(`/source/nested/input.txt`, `nested/copy.txt`, header)
			expect(writer.vfs.readFileSync(`/reports/nested/copy.txt`)).toBe(
				`${header ?? ``}contents`,
			)
			expect(writer.vfs.readFileSync(`source/nested/input.txt`)).toBe(`contents`)
		},
	)

	it(`rejects absolute destinations and missing base directories`, () => {
		const writer = new VirtualFileWriter(`/reports`)
		expect(() => new VirtualFileWriter(``)).toThrow(`baseDir`)
		expect(() => writer.writeFile(`/outside.txt`)).toThrow(`absolute path`)
		expect(() => writer.writeForDir(`/outside`)).toThrow(`absolute path`)
		expect(() => {
			writer.copyFile(`input`, `/outside`)
		}).toThrow(`absolute path`)
	})

	it(`rejects missing files and traversal through a file`, () => {
		const { vfs } = new VirtualFileWriter(`/`)
		vfs.writeFileSync(`file`, `contents`)
		expect(() => vfs.readFileSync(`missing`)).toThrow(`File not found`)
		expect(() => vfs.readFileSync(`file/child`)).toThrow(`Cannot read`)
		expect(() => vfs.readFileSync(`file/file`)).toThrow(`Cannot read`)
		expect(() => {
			vfs.writeFileSync(`file/child`, `text`)
		}).toThrow(`Cannot write`)
		const error = vi.spyOn(console, `error`).mockImplementation(() => {})
		try {
			expect(() => {
				vfs.mkdirSync(`file/child`)
			}).toThrow(`Cannot create`)
		} finally {
			error.mockRestore()
		}
	})

	it.each([`w`, `w+`])(`truncates existing files opened with %s`, (flag) => {
		const { vfs } = new VirtualFileWriter(`/`)
		vfs.writeFileSync(`nested/file`, `old contents`)
		const fd = vfs.openSync(`nested/file`, flag)
		expect(vfs.readFileSync(`nested/file`)).toBe(``)
		expect(vfs.writeSync(fd, `new`)).toBe(3)
		vfs.closeSync(fd)
		expect(vfs.readFileSync(`nested/file`)).toBe(`new`)
	})

	it.each([`a`, `a+`])(
		`appends with %s even with an explicit position`,
		(flag) => {
			const { vfs } = new VirtualFileWriter(`/`)
			const first = vfs.openSync(`file`, flag)
			vfs.writeSync(first, `one`)
			vfs.closeSync(first)
			const second = vfs.openSync(`file`, flag)
			vfs.writeSync(second, `two`, 0)
			vfs.closeSync(second)
			expect(vfs.readFileSync(`file`)).toBe(`onetwo`)
		},
	)

	it(`keeps the cursor independent of positioned writes and pads sparse writes`, () => {
		const { vfs } = new VirtualFileWriter(`/`)
		vfs.writeFileSync(`file`, `abcdef`)
		const fd = vfs.openSync(`file`, `r+`)
		vfs.writeSync(fd, `X`, 2)
		vfs.writeSync(fd, `Y`)
		vfs.writeSync(fd, `Z`)
		vfs.writeSync(fd, `!`, 8)
		vfs.closeSync(fd)
		expect(vfs.readFileSync(`file`)).toBe(`YZXdef\0\0!`)
	})

	it(`rejects invalid descriptors, flags, and paths without changing contents`, () => {
		const { vfs } = new VirtualFileWriter(`/`)
		vfs.mkdirSync(`directory`)
		vfs.writeFileSync(`file`, `contents`)
		for (const flag of [`r`, `r+`]) {
			expect(() => vfs.openSync(`missing`, flag)).toThrow(`File not found`)
		}
		expect(() => vfs.openSync(`missing/file`, `w`)).toThrow(
			`Directory not found`,
		)
		expect(() => vfs.openSync(`directory`, `w`)).toThrow(`Is a directory`)
		expect(() => vfs.openSync(`file`, `invalid`)).toThrow(`Unsupported flag`)
		const fd = vfs.openSync(`file`, `r`)
		expect(() => vfs.writeSync(fd, `changed`)).toThrow(`not open for writing`)
		vfs.closeSync(fd)
		expect(() => {
			vfs.closeSync(fd)
		}).toThrow(`Bad file descriptor`)
		expect(() => vfs.writeSync(fd, `changed`)).toThrow(`Bad file descriptor`)
		expect(vfs.readFileSync(`file`)).toBe(`contents`)
	})
})
