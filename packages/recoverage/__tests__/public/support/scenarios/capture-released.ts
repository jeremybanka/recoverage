import assert from "node:assert/strict"

// @ts-expect-error The released package is installed only in the temporary consumer.
import { capture } from "recoverage-0-1-18"

assert.equal(await capture({ defaultBranch: `trunk`, silent: true }), 0)
