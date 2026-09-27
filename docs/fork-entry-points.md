# Fork-owned entry points

Fork desktop builds use `karlorz/orca` as the public source for releases, support, skills, and CLI publication.

## Desktop and shell command

Install a fork desktop release from <https://github.com/karlorz/orca/releases>. The app bundles the version-matched CLI at these platform-specific paths:

- macOS: `/Applications/Orca.app/Contents/Resources/bin/orca`
- Linux: the installed `orca-ide` launcher
- Windows: `resources/bin/orca.exe` inside the Orca installation

Enable **Settings → General → Shell command** to register the bundled launcher on `PATH`.

The optional npm launcher exposes the same command and forwards to the installed app:

```bash
npm install --global @karlorz/orca-cli
orca status
```

The desktop app remains the CLI version authority.

## Agent skills

Fork builds install skills from the fork working branch (`fork-main`). The default onboarding cards map to fork-owned skills:

- Agent Browser Use -> `orca-cli`
- Computer Use -> `computer-use`
- Agent Orchestration -> `orchestration`

Install the default skills together:

```bash
npx skills add https://github.com/karlorz/orca/tree/fork-main --skill orca-cli --skill computer-use --skill orchestration --global
```

The npm `@karlorz/orca-cli` launcher is separate from the GitHub-installed skills: `@karlorz/orca-cli` is the shell launcher package that forwards commands to the desktop application, whereas agent skills (`orca-cli`, `computer-use`, `orchestration`) are installed directly from the `karlorz/orca` GitHub repository via `npx skills add`.

`npx skills update orca-cli computer-use orchestration --global` follows the sources recorded in `~/.agents/.skill-lock.json`. Existing upstream lock records can be migrated to the fork by rerunning the combined install command above. The skills CLI records `karlorz/orca`, `fork-main`, and the selected skill paths in `~/.agents/.skill-lock.json`.

## npm publication

`packages/orca-cli` is the only public npm package in this repository. The root desktop package is private so a release job cannot accidentally publish the full application tree.

The `Fork npm CLI Release` workflow publishes `@karlorz/orca-cli` from `fork-main` with npm trusted publishing and provenance. Before the first run:

1. Create the public `@karlorz/orca-cli` package under the npm account or organization that owns the `karlorz` scope.
2. Configure npm trusted publishing for GitHub repository `karlorz/orca`, workflow `fork-npm-cli-release.yml`, environment `npm`.
3. Create the protected GitHub environment named `npm`.
4. Bump `packages/orca-cli/package.json` for every release; published npm versions are immutable.

No npm token is stored in GitHub or the repository.

## Upstream references

References used for upstream synchronization, provenance, historical issues, upstream release trains, and copied upstream workflow fences continue to use `stablyai/orca`.
