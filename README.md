# driftcheck

> 🚧 **Work in progress.**

Keeps native Android and iOS apps in sync. driftcheck uses Claude to read how a feature is implemented on each platform, compares the two, and flags behavioral differences (timeouts, limits, validation rules, error handling, API usage) before users or testers notice them.

- **Overview:** a feature matrix of the whole app across both platforms.
- **Deep compare:** a detailed, evidence-backed comparison of one feature.
- **Drift check:** in a pull request, re-checks the features the change touches against the other platform.

See [`CLAUDE.md`](CLAUDE.md) for the project rules and architecture.
