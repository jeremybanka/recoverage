import { runBun } from "./support/bun.ts"

test(`CI refreshes the remote baseline and propagates fetch failures`, () => {
	runBun(`git-status.ts`)
})
