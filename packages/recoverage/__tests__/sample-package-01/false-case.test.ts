import { sampleFunction } from "./sample-source-with-a-very-long-name.ts"

test(`sampleFunction`, () => {
	expect(sampleFunction(false)).toBe(false)
})
