#!/usr/bin/env bun
export function choose(value: boolean): string {
	if (value) return `yes`
	return `no`
}
console.log(choose(process.argv.includes(`yes`)))
process.exit(0)
