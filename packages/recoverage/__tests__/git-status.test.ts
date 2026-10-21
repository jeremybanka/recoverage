import { runBun, sourceModule } from "./support/bun.ts"

test(`CI refreshes the remote baseline and propagates fetch failures`, () => {
	runBun(`
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(${sourceModule(`git-status.ts`)});
const { simpleGit } = require("simple-git");
const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const remote = process.cwd() + "/remote";
const checkout = process.cwd() + "/checkout";
mkdirSync(remote);
git(remote, "init", "--initial-branch=trunk");
git(remote, "config", "user.name", "Coverage test");
git(remote, "config", "user.email", "coverage@example.com");
git(remote, "commit", "--allow-empty", "-m", "initial");
git(process.cwd(), "clone", remote, checkout);
const previous = git(checkout, "rev-parse", "origin/trunk");
git(remote, "commit", "--allow-empty", "-m", "new baseline");
const latest = git(remote, "rev-parse", "trunk");
assert.notEqual(previous, latest);
process.env.CI = "true";
const { gitToolkit, getBaseGitRef } = await import(${sourceModule(`git-status.ts`)});
gitToolkit._client = simpleGit(checkout);
assert.equal(await getBaseGitRef("trunk"), latest.slice(0, 7));
assert.equal(git(checkout, "rev-parse", "origin/trunk"), latest);
gitToolkit.baseRef = undefined;
await assert.rejects(getBaseGitRef("missing-branch"));
assert.equal(gitToolkit.baseRef, undefined);
`)
})
