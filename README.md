# driftcheck

> 🚧 **Work in progress.** `overview` and `compare` work end to end; `check` is being built.

Keeps native Android and iOS apps in sync. driftcheck uses Claude to read how a feature is implemented on each platform, compares the two, and flags behavioral differences (timeouts, limits, validation rules, error handling, API usage) before users or testers notice them.

- **Overview:** a feature matrix of the whole app across both platforms.
- **Deep compare:** a detailed, evidence-backed comparison of one feature.
- **Drift check:** in a pull request, re-checks the features the change touches against the other platform.

## Getting started

Requires Node.js 20 or later, and one of:
- **Claude Code** installed and logged in (`claude`), for local use with your own Claude subscription, or
- an **Anthropic API key** in `ANTHROPIC_API_KEY`.

See [Using your Claude login or an API key](#using-your-claude-login-or-an-api-key) for which one to use.

```bash
npm install
npm run build
node dist/cli.js init                 # creates .driftcheck/config.yml
node dist/cli.js validate             # checks the config and the platform paths
node dist/cli.js verify spec.json     # checks a feature description's evidence against the source
node dist/cli.js overview             # maps the features of both apps into a feature matrix (Markdown + HTML)
node dist/cli.js report overview      # rebuilds the overview reports from stored results, without calling Claude
node dist/cli.js compare search       # describes "search" on both platforms and reports the differences
node dist/cli.js compare search --backend api   # force the API key instead of Claude Code
```

`overview` lets one read-only agent per platform list the app's user-facing features with verified entry points, matches them across platforms, and then searches the other platform for every feature that was listed on one side only (two separate inventories rarely use the same granularity). It writes `.driftcheck/reports/overview.md` and a self-contained `.driftcheck/reports/overview.html` (filterable, searchable, light/dark, works on mobile, no external resources): a feature matrix (both platforms / structured differently / Android only / iOS only / uncertain), notes on visible differences, and suggested features for a deep comparison as a ready-to-paste `features:` block for the config. The inventory is stored in `.driftcheck/inventory.json`.

`compare` runs one read-only agent per platform, verifies every claim against the source, compares the two descriptions and writes:

- `.driftcheck/specs/<feature>/{android,ios}.json`: the verified descriptions
- `.driftcheck/findings/<feature>.json`: the findings as JSON
- `.driftcheck/reports/<feature>.md`: a readable report with differences, possible bugs, questions for the team and the cost of the run

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

## How the agent is restricted

Each platform is analyzed by a Claude agent that can only use `Read`, `Grep` and `Glob`, runs without permission prompts, and never loads the analyzed repository's settings or hooks. It cannot edit files, run commands or access the network.

- **With an API key** the agent runs through the [Claude Agent SDK](https://code.claude.com/docs/en/agent-sdk) with `tools` and `allowedTools` limited to the three read tools, `permissionMode: "dontAsk"` and `settingSources: []`.
- **With Claude Code** it runs `claude -p` in restricted mode (`--restricted`, which removes command- and code-running tools and ignores the repository's settings files), with `--tools Read,Grep,Glob`, `--permission-mode dontAsk`, `--strict-mcp-config` and an explicit deny list for write, shell and web tools. `ANTHROPIC_API_KEY` is removed from its environment so it never bills the API by accident. Claude Code has no turn limit flag, so only the budget limit applies.

## Evidence, not guesses

Every claim in a feature description cites a file, a line and a short verbatim quote. `verify` checks each one against the actual source and marks it as `verified`, `quote_not_found`, `line_out_of_range` or `file_not_found`. Paths are resolved strictly inside the platform root (no absolute paths, `..` or symlinks out of the tree).

## Using your Claude login or an API key

driftcheck can reach Claude in two ways. By default (`backend: auto`) it uses `ANTHROPIC_API_KEY` if it is set, and otherwise the Claude Code CLI you are logged in to. Force one with `--backend api|claude-code` or `backend:` in `.driftcheck/config.yml`.

| You want to… | Use |
|---|---|
| Run driftcheck **locally, for yourself** | Your own **Claude Code login** (your Claude subscription). Nothing to configure. |
| Run it **for others or in shared automation**: team CI, a shared service, runs on behalf of other people | An **Anthropic API key** |

Anthropic's terms do not allow third-party tools to offer Claude subscription logins to their users, and the Claude Agent SDK requires an API key. driftcheck therefore never handles a login itself: in Claude Code mode it only calls the `claude` command that you installed and logged in to, on your own machine. Anthropic documents a subscription token for Claude Code in CI on some plans; check the terms for your plan before relying on it, otherwise use an API key.

**With an API key:**
- **Locally:** set `ANTHROPIC_API_KEY` in your shell.
- **In CI:** store one key per project as a secret (GitHub Actions secrets, Bitbucket secured repository variables). Developers do not need their own keys. A dedicated key in its own Anthropic workspace with a spend limit makes the cost visible and bounded.

**Cost and limits:** every agent run is capped by `maxBudgetUsd` (default 2 USD).
- With an API key, each run reports its estimated cost.
- With Claude Code, runs count toward your subscription's limits instead of being billed per token, so driftcheck shows how much of your **5-hour window** and **weekly limit** is used (when Claude Code reports it) instead of a dollar amount.

**Data:** your source code is sent to Anthropic for analysis, and nowhere else. Make sure that is allowed for the code you analyze.

## Development

```bash
npm test          # unit tests (no network, no API calls)
npm run check     # type check
```

See [`CLAUDE.md`](CLAUDE.md) for the project rules and architecture.

## License

MIT
