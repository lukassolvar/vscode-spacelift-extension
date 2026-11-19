# Stacks for Spacelift

Browse your [Spacelift](https://spacelift.io) stacks and runs, read plan and apply logs, and approve or discard runs without leaving VS Code.

> **Unofficial.** This extension is not affiliated with or endorsed by Spacelift, Inc.

![Run details panel](media/run-panel.png)

## Features

- **Stacks view** in the activity bar, grouped by space, with live state icons. Stacks waiting for approval are flagged.
- **Filter and sort** from the view title: presets (needs approval, failed), free-text filter over name, space and state, and sorting by name, attention or recent change.
- **Run details** panel: status, commit, trigger, Terraform version and change counts, a step-by-step timeline (queued, planning, applying, ...), and the log of each step with colored errors, warnings and plan diffs.
- **Changes tab** listing every resource the run adds, changes, replaces or deletes.
- **Approve and Discard** for runs waiting for confirmation, from the panel or the run's context menu.
- Logs and status refresh automatically while a run is in progress.

## Requirements

- VS Code 1.100 or newer.
- [`spacectl`](https://github.com/spacelift-io/spacectl), the Spacelift CLI. On macOS: `brew install spacelift-io/spacelift/spacectl`.
- A Spacelift account. The extension acts with your permissions, so you can only see and approve what Spacelift lets you.

## Getting started

1. Open the Spacelift icon in the activity bar and click **Set Up** (or run **Spacelift: Set Up** from the Command Palette).
2. Enter your account URL, for example `https://acme.app.spacelift.io`.
3. Click **Sign In**. Your browser opens to finish the login through `spacectl`.

The setup checks each step in order and offers to install `spacectl` if it is missing. If you already ran `spacectl profile login`, only the URL is needed.

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| `spacelift.endpoint` | empty | Your Spacelift account URL. Must be `https://`. |
| `spacelift.spacectlPath` | `spacectl` | Path to the `spacectl` binary. |

Both are user-level settings. Workspace settings cannot override them (see Security).

## Security

- The extension does not store credentials. It asks `spacectl profile export-token` for a short-lived token, keeps it in memory, and sends it only to your configured `https://` endpoint.
- `spacelift.endpoint` and `spacelift.spacectlPath` use VS Code's machine scope, so a repository you open cannot redirect your token or choose which program runs.
- No telemetry. The only network traffic is to your Spacelift account.
- Approve and Discard act immediately and do not ask for confirmation, matching the Spacelift web app.

## Known limitations

- Spacelift deletes run logs after your account's retention period. Older runs show a note instead of logs.
- Runs waiting on a policy review (`PENDING_REVIEW`) cannot be approved from the extension yet.
- The Changes tab needs a Terraform, OpenTofu or Terragrunt stack.
- The extension runs locally, not in remote or virtual workspaces, because it relies on your local `spacectl` login.

## Development

```sh
npm install
npm test          # unit tests (vitest)
npm run build     # compile to out/
```

Press F5 in VS Code to start an Extension Development Host. `npm run package` builds a `.vsix` you can install with `code --install-extension <file>`.

## License

[MIT](LICENSE)
