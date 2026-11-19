import assert from "node:assert/strict"

import { capture } from "recoverage"

assert.equal(await capture({ defaultBranch: `trunk`, silent: true }), 0)
