# recoverage

[![Statement coverage](https://img.shields.io/endpoint?url=https%3A%2F%2Frecoverage.cloud%2Fshields%2FMwtSPckGChfYnC633Mp-Z%2Frecoverage)](https://github.com/jeremybanka/recoverage/actions/workflows/test.yml)

`recoverage` is a command-line tool that streamlines the process of maintaining code coverage in ECMAScript projects.

The core idea is simple: **coverage should increase over time**. Recoverage supports this idea by comparing the coverage of your default branch against feature branches.

By running recoverage in CI, we can **guard against coverage regressions**. PRs that decrease coverage will fail; PRs that increase or maintain the same coverage will pass.

It's often helpful to know precisely where in our codebase coverage changed. When recoverage detects a change in coverage between our current git ref and the ref representing our current default branch, it will print a **human-readable diff of the coverage changes**.

The recoverage library and command line tool is free and open-source. You can run it on your own machine and **read a coverage diff from your own terminal**.

Recoverage works with `vitest` + `@vitest/coverage-v8`, Bun's built-in test runner,
and other runners that produce Istanbul JSON or LCOV coverage reports.

> **Please Note:** Bun is required to run this tool. You can install Bun from [bun.com/docs/installation](https://bun.com/docs/installation).

## Commands and Options

Run `recoverage` to capture and diff coverage, `recoverage capture` to capture only,
or `recoverage diff` to compare saved reports. Run `recoverage help` for usage.

All three coverage commands accept `--default-branch` (also `--defaultBranch` or
`-b`). The default is `main`. The combined command uses the selected branch for
both capture and diff:

```sh
recoverage --default-branch=trunk
recoverage capture -b trunk
recoverage diff --default-branch=trunk
```

Unknown options and options ignored by the selected command produce warnings on
stderr. Warnings are advisory; they do not change the coverage result or exit code.

### Configuration

Create `recoverage.config.json` in the directory where you run Recoverage:

```json
{
  "defaultBranch": "trunk"
}
```

Commit this file to share the baseline branch with contributors and CI. The
`defaultBranch` setting applies to `recoverage`, `recoverage capture`, and
`recoverage diff`. Use the camelCase key `defaultBranch` in JSON.

Command-line options override the config file. For example,
`recoverage diff --default-branch=release` compares against `release` even when the
file specifies `trunk`. Without a configured branch or command-line override,
Recoverage uses `main`.

The file is optional and is read from the current working directory; Recoverage
does not search parent directories. Invalid JSON or an invalid `defaultBranch`
value fails before any coverage operation runs. `defaultBranch` must be a string.

### LCOV coverage

Capture reads `coverage/coverage-final.json` when it exists. If that file is
absent, it reads `coverage/lcov.info`. If both exist, Istanbul JSON takes
precedence; invalid JSON fails instead of falling back to LCOV.

For Bun's built-in test runner, generate LCOV and run Recoverage:

```sh
bun test --coverage --coverage-reporter=lcov
recoverage
```

LCOV capture uses executable line counts (`DA` records), representing each line
as one statement for Recoverage's existing coverage comparison. Function and
branch records are ignored. Every file with executable lines in the report is
included, regardless of its directory or extension; configure exclusions in your
test runner. Repeated records for the same source file have their hit counts
added together. Empty reports and malformed line counts fail before capture
saves coverage.

Relative source paths are resolved from the directory where you run Recoverage.
Absolute paths are made relative to that directory so reports from different
checkouts use the same file names.

Use the same report format for the baseline and feature branches. LCOV line
coverage and Istanbul statement coverage can have different percentages for the
same code. When switching formats, regenerate and capture the default branch's
baseline using the new format, then regenerate coverage on your feature branch.
Remove any old `coverage/coverage-final.json` when switching to LCOV.

### Shell Completion

With `recoverage` on your `PATH`, install completion for your shell:

```sh
recoverage completion install bash
```

Replace `bash` with `zsh`, `fish`, `nushell`, or `carapace` as appropriate. Bash
requires bash-completion 2.18 or newer; Fish requires version 4 or newer. Installation
uses the shell's configured completion directories without editing shell profiles.
If your shell already uses Carapace, install the `carapace` integration.

To print an integration file for manual setup, use `recoverage completion bash`
(or another supported target) without `install`.

Completion suggests commands, options, and local Git branches for the default
branch option. Branch suggestions use the current directory's repository and do
not fetch from a remote. Completion works without coverage reports or valid
application configuration; outside Git, branch suggestions are empty.

## Persisting Coverage Reports for CI

To make a report representing your main branch available to your CI runners, you have three options:

- **Recommended**: Sign in with GitHub on [recoverage.cloud](https://recoverage.cloud) and set the following environment variables in CI:
  - `RECOVERAGE_CLOUD_TOKEN`
- **Unhosted**: Generate everything during each CI run.
  - Check out your **default** branch, run tests with coverage, then run `recoverage`.
  - Check out your **feature** branch, run tests with coverage, then run `recoverage`.
- **Self-Hosted**:
  Put your `coverage.sqlite` file in any S3-compatible storage. Then set the following environment variables in CI:
  - `S3_ACCESS_KEY_ID`
  - `S3_BUCKET`
  - `S3_ENDPOINT`
  - `S3_SECRET_ACCESS_KEY`

## Managing Recoverage Cloud

Log in with GitHub, create a project, and configure the current directory:

```sh
recoverage cloud login
recoverage cloud init --name=my-project --report=my-package
recoverage cloud status
```

Login prints a GitHub verification URL and a one-time code. Approve the code in
your browser; the CLI then saves a Recoverage account credential that expires
after 30 days. Use `--no-browser` on remote machines, then open the printed URL
on another device. GitHub access tokens are not saved by the CLI or cloud service.
Run `recoverage cloud logout` to revoke the current account credential. When
`RECOVERAGE_CLOUD_ACCOUNT_TOKEN` is set, logout revokes that token and removes a
saved credential only if it matches; a different saved account remains available.

Use `cloud init --project=PROJECT_ID` to link an existing project. Without either
`--name` or `--project`, an interactive terminal shows projects and asks you to
choose one or name a new one. Scripts must provide an explicit selection. Run
`cloud status` to find project and token IDs. Repeating `cloud init` in a linked
directory reuses its project and local reporter token; revoked tokens are replaced.

Initialization preserves existing configuration and adds a public `cloud` setting:

```json
{
  "defaultBranch": "main",
  "cloud": {
    "host": "https://recoverage.cloud",
    "projectId": "PROJECT_ID",
    "report": "my-package"
  }
}
```

Commit this configuration. `recoverage`, `capture`, and `diff` use its report name
and local reporter credential automatically. Report names contain 1–64 letters,
numbers, dots, underscores, or hyphens; `cloud init` defaults to the current
directory's name. Existing workflows without cloud configuration still use their
directory name and `RECOVERAGE_CLOUD_TOKEN`.

Credentials are stored separately in `$XDG_CONFIG_HOME/recoverage/cloud.json`
(default: `~/.config/recoverage/cloud.json`), with owner-only file permissions.
Updates are serialized across CLI processes with a lock, including token creation
during initialization. Interrupted writers leave recoverable locks; successful
writes replace the file atomically.

Account credentials manage projects, reports, and reporter tokens. Reporter tokens only
read and publish reports for their project. Account credentials do not grant
direct reporter access.

Create a separate reporter token for CI:

```sh
recoverage cloud token create ci
recoverage cloud token create ci --project=PROJECT_ID --json
recoverage cloud token revoke TOKEN_ID
```

Creation prints the secret once on stdout, with instructions on stderr. Save it
as the `RECOVERAGE_CLOUD_TOKEN` CI secret. Revocation takes the token's ID, which
`cloud status` lists, and immediately removes reporter access. Account login is
not required in CI when using a reporter token. An environment reporter token
takes precedence over the local reporter credential.

Manage projects without linking the current directory, and inspect reporter tokens:

```sh
recoverage cloud project list
recoverage cloud project show PROJECT_ID
recoverage cloud project create my-project
recoverage cloud project rename PROJECT_ID new-name
recoverage cloud token list
recoverage cloud project delete PROJECT_ID --yes
```

Project deletion removes all its reports and tokens. If this directory is linked
to that project, deletion also removes its `cloud` configuration and local reporter
credential while preserving other configuration. `project create` creates a project;
use `cloud init --project=PROJECT_ID` to link it.

Inspect and manage reports in the linked project, or pass `--project=PROJECT_ID`:

```sh
recoverage cloud report list
recoverage cloud report show my-package --json
recoverage cloud report upload my-package
recoverage cloud report upload my-package --file=coverage/lcov.info
recoverage cloud report download my-package --output=saved-coverage.json
recoverage cloud report delete my-package --yes
recoverage cloud badge my-package --markdown
```

Explicit upload works on any branch and does not require a Git repository. It
reads `coverage/coverage-final.json` (Istanbul JSON), falling back to
`coverage/lcov.info` only when that JSON file is absent. `--file` selects an
Istanbul JSON file or LCOV file with an `.info` or `.lcov` extension. Invalid or
empty coverage fails before upload. LCOV represents one statement per executable
line. Uploading an existing ref replaces it even when the project has reached
its report limit; deleting a report frees a slot.

`report list` and `report show` return summaries without downloading the full map.
`report download` writes the map as JSON to stdout, including with `--json`, or
to a new file with `--output`. It refuses to overwrite an existing file. Istanbul
maps can be uploaded again with `--file`; legacy V8 maps remain downloadable in
their stored format. Explicit report commands also accept legacy names with spaces
and percent signs; refs must contain 1–64 characters and no slashes or control
characters, and cannot be `.` or `..`.

Project and report deletion prompt for confirmation in a terminal. Scripts must
pass `--yes`. `cloud badge` prints the Shields.io image URL; `--markdown` prints
an image snippet, and `--json` returns the endpoint, image URL, and Markdown. Badge
endpoints are public and expose statement coverage, while report maps require
authentication. Badge creation requires an existing report with a summary.

All cloud commands accept `--json` for machine-readable results on stdout and
`--host=HTTPS_ORIGIN` to select a service. `RECOVERAGE_CLOUD_URL` overrides the
configured host; HTTP is allowed only for localhost development. Account credentials
are stored per host and reporter credentials per host and project. For headless
management, supply `RECOVERAGE_CLOUD_ACCOUNT_TOKEN` as a secret environment variable;
it is separate from `RECOVERAGE_CLOUD_TOKEN`. Errors go to stderr and exit with
status 1. Login instructions and token-storage instructions remain on stderr
when using `--json`.

## Local Example

Below is an example to set up a tiny project with Bun, TypeScript, Vitest, and @vitest/coverage-v8.

### 1. Initialize the Project

Create a new directory and initialize it:

```sh
mkdir my-demo-project
cd my-demo-project
bun init
```

Then, update your package.json with the following scripts and devDependencies:

```json
{
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "cov": "vitest run --coverage",
    "cov:check": "bun run cov && recoverage"
  },
  "devDependencies": {
    "typescript": "^6.x",
    "vitest": "^4.x",
    "@vitest/coverage-v8": "^4.x",
    "recoverage": "^0.1.x"
  }
}
```

### 2. Set Up TypeScript

Create a `tsconfig.json` file:

```json
{
  "compilerOptions": {
    "target": "ES2024",
    "module": "ESNext",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true
  },
  "include": ["src", "__tests__"]
}
```

### 3. Create a Source File with a Demo Function

Create the file src/demo.ts:

```ts
export function demoSwitch(input: string): string {
  switch (input) {
    case "case1":
      return "Result for case 1";
    case "case2":
      return "Result for case 2";
    case "case3":
      return "Result for case 3";
    default:
      return "Default case";
  }
}
```

### 4. Create a Test File for the Demo Function

Create the file `__tests__/demo.test.ts` with initial tests covering two cases:

```ts
import { demoSwitch } from "../src/demo";

test("demoSwitch covers case1", () => {
  expect(demoSwitch("case1")).toBe("Result for case 1");
});

test("demoSwitch covers case2", () => {
  expect(demoSwitch("case2")).toBe("Result for case 2");
});

// test("demoSwitch covers case3", () => {
//   expect(demoSwitch("case3")).toBe("Result for case 3");
// });
```

This will give us a baseline coverage report less than 100%.

### 5. Configure Vitest Coverage Settings

Create a `vitest.config.ts` file:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    coverage: {
      reporter: ["text", "json"],
    },
  },
});
```

### 6. Initialize Git and Capture Base Coverage

Check your project into Git on the main branch:

```sh
git init
git add .
git commit -m "Initial commit with base tests"
```

Now run the tests and capture your base coverage report:

```sh
bun run cov:check
```

This command runs Vitest (which generates coverage-final.json) and then runs recoverage capture to save your base coverage report.

## Showing Coverage Changes

### Coverage Decrease

1. **Modify the Test File:**

   Comment out one of the tests so that only one case is covered. Update `__tests__/demo.test.ts` as follows:

   ```ts
   import { demoSwitch } from "../src/demo";

   test("demoSwitch covers case1", () => {
     expect(demoSwitch("case1")).toBe("Result for case 1");
   });

   // test("demoSwitch covers case2", () => {
   //   expect(demoSwitch("case2")).toBe("Result for case 2");
   // });

   // test("demoSwitch covers case3", () => {
   //   expect(demoSwitch("case3")).toBe("Result for case 3");
   // });
   ```

2. **Re-Run the Tests** (and Capture Coverage):

   With floating changes on your branch, run:

   ```sh
   bun run cov:check
   ```

   This command will detect that coverage has decreased (fewer cases are covered) and exit with code `1`.

### Coverage Increase

1. **Modify the Test File:**

   Uncomment all the tests so that all cases are covered. Update `__tests__/demo.test.ts` as follows:

   ```ts
   import { demoSwitch } from "../src/demo";

   test("demoSwitch covers case1", () => {
     expect(demoSwitch("case1")).toBe("Result for case 1");
   });

   test("demoSwitch covers case2", () => {
     expect(demoSwitch("case2")).toBe("Result for case 2");
   });

   test("demoSwitch covers case3", () => {
     expect(demoSwitch("case3")).toBe("Result for case 3");
   });
   ```

2. **Re-Run the Tests** (and Capture Coverage):

   With floating changes on your branch, run:

   ```sh
   bun run cov:check
   ```

   This command will detect that coverage has increased (more cases are covered) and exit with code `0`.
