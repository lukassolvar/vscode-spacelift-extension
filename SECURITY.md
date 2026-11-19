# Security Policy

This extension handles a short-lived Spacelift access token, so security reports are taken seriously.

## Reporting a vulnerability

Please do not open a public issue for security problems.

- Use GitHub's private reporting: open the repository's **Security** tab and choose **Report a vulnerability**.
- Or email **lukas@dubs.cz** with "Spacelift extension security" in the subject.

Include the extension version, your VS Code version and operating system, and steps to reproduce. Please do not include real tokens, account URLs or customer data. Redact them.

This is a spare-time project, so there is no guaranteed response time. Reports are handled on a best-effort basis, and reporters are credited in the changelog unless they prefer otherwise.

## Supported versions

Only the latest published release receives fixes.

## Scope

In scope:

- Leaking or mishandling the Spacelift token, or sending it anywhere other than the configured `https://` endpoint.
- Running a program other than the configured `spacectl`, or letting a workspace change which program runs or where the token is sent.
- Script injection through log text, run titles, commit messages or other data shown in the run panel.
- Performing actions (approve, reject, confirm, discard) the user did not request.

Out of scope:

- Vulnerabilities in Spacelift itself or in `spacectl`. Report those to [Spacelift](https://spacelift.io).
- Vulnerabilities in VS Code or Node.js.
- Actions a user is allowed to perform in Spacelift, such as approving a run they have permission to approve.

## How the extension protects credentials

- No credentials are stored. The token comes from `spacectl profile export-token`, is kept in memory only, and is refreshed when Spacelift rejects it.
- `spacelift.endpoint` and `spacelift.spacectlPath` are machine-scoped settings, so a workspace cannot override them. Requests to a non-`https` endpoint are refused before any token is read.
- Everything shown in the run panel is HTML-escaped, and the panel runs under a strict Content Security Policy that only allows its own inline script and style.
- There is no telemetry.
