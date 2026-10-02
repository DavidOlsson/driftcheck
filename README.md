# driftcheck

> 🚧 **Work in progress.** The project skeleton (config, evidence verification) works; the agent-based `overview`, `compare` and `check` commands are being built.

Keeps native Android and iOS apps in sync. driftcheck uses Claude to read how a feature is implemented on each platform, compares the two, and flags behavioral differences (timeouts, limits, validation rules, error handling, API usage) before users or testers notice them.

- **Overview:** a feature matrix of the whole app across both platforms.
- **Deep compare:** a detailed, evidence-backed comparison of one feature.
- **Drift check:** in a pull request, re-checks the features the change touches against the other platform.

## Getting started

Requires Node.js 20 or later.

```bash
npm install
npm run build
node dist/cli.js init                 # creates .driftcheck/config.yml
node dist/cli.js validate             # checks the config and the platform paths
node dist/cli.js verify spec.json     # checks a feature description's evidence against the source
```

`.driftcheck/config.yml` points at the two apps and lists the features to compare:

```yaml
version: 1
platforms:
  android:
    path: android
  ios:
    path: ios
features:
  - id: search
    name: Search
    hints: [SearchFragment]
```

## Evidence, not guesses

Every claim in a feature description cites a file, a line and a short verbatim quote. `verify` checks each one against the actual source and marks it as `verified`, `quote_not_found`, `line_out_of_range` or `file_not_found`. Paths are resolved strictly inside the platform root (no absolute paths, `..` or symlinks out of the tree).

## API key and data

driftcheck calls the Anthropic API with the key in `ANTHROPIC_API_KEY`.

- **Locally:** set `ANTHROPIC_API_KEY` in your shell.
- **In CI:** store one key per project as a secret (GitHub Actions secrets, Bitbucket secured repository variables). Developers do not need their own keys. A dedicated key in its own Anthropic workspace with a spend limit makes the cost visible and bounded.
- **Cost control:** every agent run is capped by `maxBudgetUsd` (default 2 USD) and `maxTurns`, and each run reports its cost.
- **Your source code is sent to the Anthropic API** for analysis, and nowhere else. Make sure that is allowed for the code you analyze.

## Development

```bash
npm test          # unit tests (no network, no API calls)
npm run check     # type check
```

See [`CLAUDE.md`](CLAUDE.md) for the project rules and architecture.

## License

MIT
