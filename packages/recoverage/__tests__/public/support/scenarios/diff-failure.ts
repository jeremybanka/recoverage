import assert from "node:assert/strict"

import { diff } from "recoverage"

assert.equal(await diff(`trunk`, true), 1)
