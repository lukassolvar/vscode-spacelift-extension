# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/).

## [0.2.0] - 2026-11-20

First public version.

### Added

- Activity-bar view of Spacelift stacks grouped by space, with state icons and a flag on stacks waiting for approval.
- Filter (presets, "needs approval", free text) and sort (name, needs attention first, recently changed) from dropdown menus. Choices persist across restarts.
- Run details panel with a step timeline, per-step logs with colored errors, warnings and plan diffs, a Changes tab, commit and trigger details, and live updates while a run is in progress.
- Approve and Discard for runs waiting for confirmation.
- Approve and Reject reviews for runs that need approval-policy sign-off, including proposed runs in `PENDING_REVIEW`. Proposed runs appear in the tree only while they await review.
- Guided setup: checks for `spacectl`, asks for the account URL, and signs in through the browser. Offers to install `spacectl` with Homebrew on macOS and winget on Windows, and opens the install guide on Linux.
- Authentication through the local `spacectl` login, with no stored credentials.
- Inline status in `.tf` files: above each `spacelift_stack` resource, a line with the stack's state, when it last changed and who approved, discarded or triggered it. Clicking it opens the run, and a plain-text tooltip summarises the run, commit and change counts.
- Approve and Discard (or Approve review and Reject) buttons next to that line when a run is waiting. They ask for confirmation before acting.
- A hover card on the `resource` line with a colored status, the run, commit, change counts, state history and action links.
- `spacelift.inlineStatus` setting to turn the inline status off.

### Security

- `spacelift.endpoint` and `spacelift.spacectlPath` are machine-scoped, so a workspace cannot override them.
- The client refuses non-`https` endpoints before reading a token.
- Run panel content is escaped and served under a strict Content Security Policy.
- Pinned `minimatch` to a patched version in the build tooling, so `npm audit` reports no vulnerabilities.
- Hover card links can only run the extension's own commands, and repository text in the card is escaped so it cannot add links.

### Notes

- Spacelift deletes run logs after the account's retention period. Older runs show an explanatory note instead of logs.
- The extension starts in any workspace that contains `.tf` files, so the inline status is ready without opening the sidebar first.
- Unofficial and not affiliated with Spacelift, Inc.
