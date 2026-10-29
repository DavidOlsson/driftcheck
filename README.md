<p align="center"><img src="docs/logo.png" alt="driftcheck logo: two cars drifting side by side" width="240"></p>

# driftcheck

[![CI](https://github.com/DavidOlsson/driftcheck/actions/workflows/ci.yml/badge.svg)](https://github.com/DavidOlsson/driftcheck/actions/workflows/ci.yml)

driftcheck compares how a feature is implemented in the Android and iOS versions of the same app, and reports where the two have drifted apart.

**Live example:** [driftcheck's report on the Wikipedia apps' search](https://davidolsson.github.io/driftcheck/) · **Download:** [latest release](https://github.com/DavidOlsson/driftcheck/releases/latest)

## What it does

Many teams build the same app twice, in Kotlin for Android and in Swift for iOS. Over time the two drift apart: different timeouts, limits, validation, error handling, or a feature that only exists on one side. Nobody notices until a user or a tester does.

driftcheck is a command-line tool. For one feature, such as search, it lets Claude read the code of both apps and describe each in the same fixed structure. It then checks every claim against the source by file, line and quote, compares the two descriptions, and writes an HTML report of the differences: what is verified, what is not, and questions for the team.

## Getting started

### Requirements

- **JDK 17 or newer**, to run driftcheck.
- **[Claude Code](https://claude.com/claude-code)**, installed and logged in (`claude`). driftcheck runs it as `claude -p`, so runs count toward your Claude plan. No API key is needed. In CI, set `CLAUDE_CODE_OAUTH_TOKEN` to a token from `claude setup-token` instead of logging in.
- **The source code of both apps**, on your machine.

### Installation

Download `driftcheck-<version>.zip` from [GitHub Releases](https://github.com/DavidOlsson/driftcheck/releases/latest), unzip it and put its `bin` directory on your `PATH`.

Or build it yourself:

```bash
git clone https://github.com/DavidOlsson/driftcheck
cd driftcheck
./gradlew installDist    # builds a runnable copy in build/install/driftcheck
build/install/driftcheck/bin/driftcheck --version
```

### Configuration

Go to a folder that contains both apps, then run `driftcheck init`. It creates `.driftcheck/config.json`; edit it to point at the apps and list the features to compare:

```json
{
  "version": 1,
  "name": "Wikipedia",
  "platforms": {
    "android": { "path": "android" },
    "ios": { "path": "ios" }
  },
  "features": [
    { "id": "search", "name": "Search", "hints": ["SearchFragment"] }
  ],
  "model": "claude-sonnet-5-5",
  "maxBudgetUsd": 2,
  "timeoutMinutes": 30
}
```

| Field | Meaning |
|---|---|
| `name` | The app's name, shown at the top of every report. |
| `platforms` | The two apps' source folders. They must be separate folders inside the project, not the project root itself, unless you pass `--allow-external-paths`. |
| `features` | The features to compare. `id` is used on the command line. `hints` are optional pointers (class names, folders, screens) that help Claude find the feature faster: at most 20, each at most 200 characters. |
| `model` | Optional. The Claude model, `claude-sonnet-5-5` by default. |
| `maxBudgetUsd` | Optional. The budget per Claude run, 2 by default, at most 20. |
| `timeoutMinutes` | Optional. How long each platform's description may take, 30 by default, at most 120. |

No other configuration or environment variables are needed. The only exception is `CLAUDE_CODE_OAUTH_TOKEN`, when Claude Code cannot log in interactively.

### Run it

```bash
driftcheck compare search            # describes "search" on both platforms and reports the differences
driftcheck report search             # rebuilds the report from stored results, without Claude
driftcheck verify .driftcheck/specs/search/android.json   # checks a description's evidence again
driftcheck --help                    # all commands and options
```

`compare` makes three Claude runs: one read-only agent per platform, then one run without tools that compares the two descriptions. Before it starts, it shows the maximum total cost. It writes:

- `.driftcheck/specs/<feature>/{android,ios}.json`: the verified descriptions
- `.driftcheck/findings/<feature>.json`: the findings, with the model and usage of the run
- `.driftcheck/reports/<feature>.html`: the report. It is one self-contained HTML file that opens in any browser, also offline. Differences are listed most severe first, filterable and searchable, with both platforms side by side and every source reference marked as verified or not.

A real report on the Wikipedia apps is [live](https://davidolsson.github.io/driftcheck/) and in [examples/wikipedia-search.html](examples/wikipedia-search.html).

## Architecture

driftcheck is one Gradle module. `commands` runs the pipeline:

1. `extract` describes the feature on each platform through `claude`.
2. `evidence` verifies every claim against the source through `source`.
3. `compare` compares the two descriptions.
4. `report` renders the HTML.
5. `store` writes the results.

All model output is untrusted: `model` holds the classes that both generate the JSON schema sent to Claude and validate the answer. Running programs sits behind `process`, and every Claude call behind `claude`, so the tests use fakes and never call Claude.

```
src/main/kotlin/driftcheck/
├── Main.kt       # command line: arguments, exit codes
├── commands/     # init, compare, verify and report
├── config/       # .driftcheck/config.json: loading and validation
├── claude/       # claude -p: arguments, environment, output parsing
├── extract/      # prompts and the per-platform description run
├── evidence/     # checks file, line and quote against the source
├── compare/      # the run that compares the two descriptions
├── report/       # the self-contained HTML report
├── store/        # writes results inside .driftcheck/, never through symlinks
├── model/        # descriptions, findings and usage, and the schema for model output
├── process/      # runs programs without a shell, always with a timeout
└── source/       # reads source files, never outside a platform's folder
demo/wikipedia/   # config for the live Wikipedia report
examples/         # a real report
```

## Tech stack

| Component | Choice | Why |
|---|---|---|
| Language | Kotlin on the JVM, Java 17 | The language of Android teams, and almost every Android developer already has JDK 17. |
| Build and release | Gradle with the `application` plugin | Builds a runnable zip that is attached to a GitHub release. |
| AI | Claude Code (`claude -p`) | Uses the user's own Claude login and its read-only file tools, so driftcheck needs no API key, no SDK and no login of its own. |
| Model output and config | kotlinx.serialization | One set of classes generates the JSON schema and validates every answer and the config. |
| Tests and style | JUnit 5, ktlint | Tests with fakes instead of real Claude calls, and a consistent style checked in CI. |
| CI/CD | GitHub Actions, GitHub Pages | Tests and lint on every pull request, a release on every new version, and the live report on Pages. |

## How the agent is restricted

Each platform is analyzed by `claude -p` with its source folder as working directory, and:

- only the `Read`, `Grep` and `Glob` tools, with write, shell, web and agent tools explicitly denied
- `--restricted`, so the analyzed repository's settings, `CLAUDE.md`, skills and agents are never loaded, with `--safe-mode` as a second layer
- `--strict-mcp-config`, `--permission-mode dontAsk` and no session persistence
- no `ANTHROPIC_*` or `CLAUDE_CODE_USE_*` variables, so a run never bills an API key or cloud account and never sends code to another endpoint

The analyzed code is treated as data: prompts say so, and nothing in the repository can change how driftcheck or the agent behaves.

## Evidence, not guesses

Every item in a description cites a file, a line and a short verbatim quote. driftcheck checks each one against the source:

- **Found:** a quote within three lines of the cited line, and at least 6 characters without whitespace, counts as `verified`.
- **Otherwise** it is marked `quote_too_short`, `quote_not_found`, `line_exists`, `line_out_of_range`, `file_not_found` or `file_too_large` (over 5 MB).
- **Paths** are resolved strictly inside the platform's folder: no absolute paths, `..` or symlinks out of it.
- **Items without any evidence** are left out and listed in the report.

Findings may only cite evidence from the two descriptions. The report marks references that could not be confirmed with ⚠, and flags findings without any source.

## Limitations

- **Results vary between runs.** Claude describes and compares the code, so two runs on the same code give similar but not identical findings. Treat a report as a well-sourced starting point for review, not as a complete audit.
- **Verified means the quote exists, not that the claim is right.** A finding can cite a real line and still describe its behavior wrongly.
- **One feature at a time.** There is no overview of all features, no pull request check and no way to mark a difference as intentional.
- **Usage limits are approximate.** `maxBudgetUsd` is passed to Claude Code, which can go slightly over it. Plan usage is only shown when Claude Code reports it.
- **Large outputs are held in memory.** driftcheck reads Claude Code's whole output before parsing it.
- **Tested on macOS and Linux.** Windows is not tested.

## Development

```bash
./gradlew build          # compiles, runs the tests (Claude is never called) and checks the style with ktlint
./gradlew ktlintFormat   # fixes style errors
```

- **CI** runs `./gradlew build` on every pull request.
- **Releases:** after a merge to main, a new `version` in `build.gradle.kts` is published as a GitHub release with the zip.
- **The live report** is regenerated by hand with the `Wikipedia report` workflow. It keeps the run's results as an artifact.

See [`CLAUDE.md`](CLAUDE.md) for the project rules.

## License

[MIT](LICENSE)
