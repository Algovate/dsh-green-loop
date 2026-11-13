# Security

Green Loop runs shell commands. Its trust model is deliberately small and explicit.

## What runs

- The check command is either `config.command` or a command detected read-only from the
  session's project root (`package.json` test script, pytest layout, `go.mod`, `Cargo.toml`,
  `Makefile` test target).
- Detection only reads files; it never executes while detecting.
- The model cannot change the command or arm the loop. `green_check` is a probe; it does not
  arm or steer.
- A check runs through `ctx.shell`, the same executor and sandbox as the `bash` tool, with the
  session's working directory and the deployment's sandbox policy.

## What does not happen

- No credentials are read.
- No network requests are made by the plugin itself.
- No project files are written by the plugin.
- No output beyond `outputTailChars` is retained for steering or the dock.

## User responsibilities

Arming is the authorization to run the configured command after every turn. Treat the command
like a `package.json` script or a CI job: only use it in projects whose commands you trust.
Disarm the loop if the agent is working in an untrusted checkout.

## Reporting

Once the package has a public repository, report vulnerabilities through that repository's
private security advisory. Do not include secrets, tokens, or full session logs in a public
issue.
