# Changelog

All notable changes to MetaTrooper are listed here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).
The version lives in the root `package.json`; `node tests/version-check.mjs` checks every other manifest against it.

## [Unreleased]

### Added

- metarouter joins the repo as `router/`, with its history. `troop route <args>` runs it with no separate install
  (Python 3.11+, or `TROOP_PYTHON`); `troop gate` reads A-05 from the same copy; `router/` is also a plugin whose
  `ingest` action now answers in the plugin contract shape. Its tests run in CI.
- metarouter is on by default in every session the desk starts: `router/bin` first on `PATH`, and Claude sessions get
  the metarouter block through `--append-system-prompt`. `sessions.metarouter: false` turns it off.
- Release gate `tests/release.ps1`: version check, core and workbench suites, every opt-in suite, then the listener check.
- CI on `windows-latest` and `ubuntu-24.04` for every push to main; a `v*` tag makes a draft release with SHA-256 checksums.
- One version source in the root `package.json`, with `tests/version-check.mjs`.

### Changed

- The repo plugin's version moves from 1.0.0 to 0.1.0 to match the root version.

## [0.1.0]

Not yet tagged. Milestones 1 to 4, as recorded in `status/M1-STATUS.md` to `status/M4-STATUS.md`.

### Added

- M1: the core (SQLite store, pipe, sessions, gates), the `troop` CLI and the Electron workbench.
- M2: pipelines and the plugin runtime, with approval profiles and secrets kept with DPAPI.
- M3: the built-in pipelines and plugins, among them two-engine review, browser QA, docs and release notes.
- M4: shared browser panes, the code map, the secret scan, session glue and clean test suites.

[Unreleased]: https://github.com/Wasif-ZA/metatrooper/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/Wasif-ZA/metatrooper/releases/tag/v0.1.0
