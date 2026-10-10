# Fork-owned entry points

Fork desktop builds use `karlorz/orca` as the public source for releases, support, skills, and CLI publication.

## Desktop and shell command

Install a fork desktop release from <https://github.com/karlorz/orca/releases>. The app bundles the version-matched CLI at these platform-specific paths:

- macOS: `/Applications/Orca.app/Contents/Resources/bin/orca`
- Linux: the installed `orca-ide` launcher
- Windows: `resources/bin/orca.exe` inside the Orca installation

Enable **Settings → General → Shell command** to register the bundled launcher on `PATH`.

For the persistent Linux box home install, see [Linux home AppImage install](reference/linux-home-appimage-install.md): user-owned AppImage, Fork-5 launcher, version pin, and ensure repair after Update Bot's Computer.

The optional npm launcher exposes the same command and forwards to the installed app:

```bash
npm install --global @karlorz/orca-cli
orca status
```

The desktop app remains the CLI version authority.

## Mobile Android APK updates

Fork Android APKs check GitHub Releases on `karlorz/orca` for `mobile-android-v*` tags. This is an APK download check from the home card and the protocol wall, not Expo EAS OTA. Installed `expo.version` is the published train (`0.0.52` today); fork tags carry a suffix (`mobile-android-v0.0.52-3`). The checker offers a newer train only. The published same-train APK is `mobile-android-v0.0.52-3` (versionCode 86). It is a manual install because the binary still reports the train `0.0.52`.

The About source row and Settings Support issues link also use `karlorz/orca`.

## Current upstream sync and release trains

As of 2026-10-03 the published upstream trains and fork tags are:

| Train          | Upstream release                                                                                 | Fork tag                                      | Notes                                                                                                          |
| -------------- | ------------------------------------------------------------------------------------------------ | --------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Desktop        | [`v1.4.219`](https://github.com/stablyai/orca/releases/tag/v1.4.219)                             | `v1.4.219-0`                                  | Auto-cut after attended merge `9106b8e404`.                                                                    |
| Mobile Android | [`mobile-android-v0.0.52`](https://github.com/stablyai/orca/releases/tag/mobile-android-v0.0.52) | `mobile-android-v0.0.52-3` | Published APK, expo `0.0.52`, versionCode 86. `-3` is the APK that checks `karlorz/orca`. Train string stays `0.0.52`. |

The 2026-10-01 sync that first landed `v1.4.217` / `mobile-android-v0.0.50` is historical: merge `ce818bd5151a02937033752cb22cae2a522ba81b`, later run [`36764405538`](https://github.com/karlorz/orca/actions/runs/36764405538). Desktop retry `v1.4.217-1` published through [workflow run `36746061692`](https://github.com/karlorz/orca/actions/runs/36746061692) (no APK). Mobile on that train ended at `mobile-android-v0.0.50-8`.

## Tag-to-release lifecycle

1. The **Sync fork main from upstream** workflow fast-forwards `main` from
   `stablyai/orca`, merges upstream `main` into `fork-main`, mirrors upstream
   tags, and auto-cuts `v<base>-0` and `mobile-android-v<train>-0` when a new
   train has no fork suffix. It runs on the daily schedule or by
   `workflow_dispatch`.
2. Desktop tags use `v<base>-N`, such as `v1.4.219-0`. Mobile tags use
   `mobile-android-v<train>-N`, such as `mobile-android-v0.0.52-1`. The two
   workflows have separate tag filters and release assets.
3. An attended desktop cut runs from a clean, pushed `fork-main` with
   `node config/scripts/fork-next-desktop-tag.mjs --write`; the automatic sync
   path uses `--auto`. An attended mobile cut uses
   `node config/scripts/fork-next-mobile-tag.mjs --write`, which advances
   `mobile/app.json` to the published upstream train and never rewinds
   `versionCode`.
4. A desktop tag starts **Fork Desktop Release**. Its verify job checks the
   `v<x.y.z>-<N>` shape and reachability from `fork-main`. Successful builds
   publish macOS self-signed DMG/ZIP files, Linux AppImage/deb/rpm packages,
   Windows unsigned NSIS files, platform update manifests, blockmaps, and
   `SHA256SUMS.txt`.
5. A mobile tag starts **Fork Mobile Android Release**. It publishes the APK,
   `BUILD-METADATA.json`, `TEST-SUMMARY.md`, and `SHA256SUMS.txt`. Desktop files
   stay off mobile releases, and mobile APK files stay off desktop releases.
6. Each workflow creates a draft prerelease, verifies the uploaded assets and
   checksums, then runs
   `gh release edit <tag> --draft=false --prerelease --latest=false`. After the
   workflow succeeds, an operator selects the
   intended release in GitHub, clears **Pre-release**, and switches **Latest**
   through the GitHub release UI when that release should become the fork's
   current latest desktop or mobile release.

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
