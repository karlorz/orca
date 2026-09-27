# `@karlorz/orca-cli`

This package exposes the `orca` command and forwards it to the version-matched CLI bundled with a [karlorz/orca](https://github.com/karlorz/orca) desktop installation.

```bash
npm install --global @karlorz/orca-cli
orca status
```

Install Orca Desktop first, then enable **Settings → General → Shell command**. The launcher checks registered commands and standard installation locations on macOS, Linux, and Windows.

The desktop release remains the CLI version authority, so app updates and CLI behavior stay paired.
