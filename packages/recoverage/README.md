# recoverage

`recoverage` is a command-line tool that streamlines the process of maintaining code coverage in ECMAScript projects.

The core idea is simple: **coverage should increase over time**. Recoverage supports this idea by comparing the coverage of your default branch against feature branches.

By running recoverage in CI, we can **guard against coverage regressions**. PRs that decrease coverage will fail; PRs that increase or maintain the same coverage will pass.

It's often helpful to know precisely where in our codebase coverage changed. When recoverage detects a change in coverage between our current git ref and the ref representing our current default branch, it will print a **human-readable diff of the coverage changes**.

The recoverage library and command line tool is free and open-source. You can run it on your own machine and **read a coverage diff from your own terminal**.

Recoverage works smoothly `vitest` + `@vitest/coverage-v8`, as well as many other runners. Anything that creates an istanbul-style coverage report at `coverage/coverage-final.json` will work.

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
    "test": "vitest",
    "test:coverage": "vitest run --coverage && recoverage"
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
bun run test:coverage
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
   bun run test:coverage
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
   bun run test:coverage
   ```

   This command will detect that coverage has increased (more cases are covered) and exit with code `0`.
