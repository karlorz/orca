# Linux home AppImage install

This box-specific path installs the `karlorz/orca` desktop AppImage under the user's home directory. It survives **Update Bot's Computer**, which preserves `/home/box` and `/workspace`. The install script uses no root commands and launches no GUI.

## Paths and ownership

| File                                             | Purpose                                                          |
| ------------------------------------------------ | ---------------------------------------------------------------- |
| `~/.local/opt/orca/orca-linux.AppImage`          | Current executable, owned and writable by the user               |
| `~/.local/opt/orca/release-tag`                  | Exact fork desktop version to restore                            |
| `~/.local/opt/orca/appimage.sha256`              | Verified checksum of the installed image                         |
| `~/.local/opt/orca/orca-linux.AppImage.previous` | One previous image, with matching `.previous` tag/checksum files |
| `~/bin/orca-ide-newbie`                          | AppImage launcher, display defaults to `:5`                      |
| `~/orca-ide-profile/Fork-5`                      | Existing profile, passed as `--user-data-dir` for GUI launches   |
| `~/.local/share/box-persist/`                    | Persistent installer and ensure scripts                          |

The shell launcher preserves `ORCA_USER_DATA_PATH` for CLI calls. The existing dock/desktop entries already call `~/bin/orca-ide-newbie`. `~/bin` should be on `PATH`; invoking the full path also works. The published fork AppImage asset currently targets Linux x86_64; the installer refuses other hosts. Run installation and ensure on the execution host when using SSH.

## First install

From the fork checkout:

```bash
bash config/scripts/install-orca-home-appimage.sh --latest
```

Requirements: Bash, `gh`, and Node 24 (native TypeScript support for the shared installer modules). Downloads use GitHub CLI authentication already configured on the host. The installer selects the highest numbered published `vX.Y.Z-N` fork desktop release in the latest 100 releases with both `orca-linux.AppImage` and `SHA256SUMS.txt`. Published prereleases are eligible. Mobile tags, upstream mirror tags, drafts, and incomplete releases are excluded; use `--tag` if the desired release falls outside that bounded list.

Download and validation happen in a staging directory beside the destination. The script verifies exactly one checksum entry and extracts `resources/package-type` to require `AppImage` and the required `resources/orcad-template/orcad-template.json` manifest to reject incomplete SSH deployment packages. It switches the image and launcher only after validation. It retains one previous image and backs up the original launcher as `~/bin/orca-ide-newbie.pre-appimage`. A lock prevents overlapping installs.

Installation leaves a running Orca process alive. Save work and close Orca manually when ready, then start it with:

```bash
~/bin/orca-ide-newbie
```

## Pin and repair after Update

```bash
# Healthy pins verify locally, with no GitHub request.
bash ~/.local/share/box-persist/install-orca-home-appimage.sh --ensure

# A missing/corrupt image downloads the exact saved tag.
bash ~/.local/share/box-persist/orca-box-ensure.sh --install

# Explicitly select a new version; restart later when work is saved.
bash ~/.local/share/box-persist/install-orca-home-appimage.sh --latest
bash ~/.local/share/box-persist/install-orca-home-appimage.sh --tag v1.4.222-1
```

`--ensure` restores or repairs an existing install. First installation requires an explicit `--latest` or `--tag`. The app and installer share SHA256 and extracted-marker verification plus the image/pin transaction. `commit` writes `release-tag`, `appimage.sha256`, and `installed-release.json` together. `installed-release.json` binds the installed tag to its verified digest. Missing, corrupt, or stale pins are rebuilt from that identity only when the installed bytes still match the recorded digest. A matching local pin and checksum is not enough to rewrite identity: missing or corrupt JSON, or a byte swap with an updated checksum, fails closed and needs an attended `--tag` or `--latest` reinstall. A missing or damaged image is downloaded at the recorded tag. Recopy the persist installer scripts from this tree after pulling; a leftover box copy of the older bash installer will not write the JSON identity on `--tag`.

The transaction fsyncs staged bytes, journals the target tag/digest/staging path in `.install-pending`, renames the image, then atomically renames the checksum, pin, and identity record. A filesystem cannot rename several files in one operation: the durable journal makes interrupted switches recover forward to the verified target before any repair decision. Startup compares the running version with the verified disk identity. A newer disk image offers Restart to Update; an older disk image requires attended repair. A same-tag replacement with different bytes is rejected. Only a checksum- and marker-verified current image replaces the single previous image.

Both actors acquire `.install-lock` with exclusive directory creation. A crash leaves that lock in place and fails closed. An operator must establish that its owner has exited before removing the lock and running `--ensure`; contact loss alone is insufficient.

## Box persistence integration

Preserve the current box-specific profile restore implementation, then install the small home-aware entry point beside it:

```bash
persist="$HOME/.local/share/box-persist"
mkdir -p "$persist"
if [ ! -e "$persist/orca-box-ensure-deb.sh" ]; then
  cp -p "$persist/orca-box-ensure.sh" "$persist/orca-box-ensure-deb.sh"
fi
cp config/scripts/install-orca-home-appimage.sh \
   config/scripts/orca-home-appimage-install-cli.mjs \
   config/scripts/orca-home-launcher.sh \
   config/scripts/orca-box-ensure.sh "$persist/"
cp src/main/orca-home-appimage-install.ts "$persist/orca-home-appimage-install.ts"
cp src/main/orca-home-appimage-verification.ts "$persist/orca-home-appimage-verification.ts"
chmod +x "$persist"/{install-orca-home-appimage,orca-home-launcher,orca-box-ensure}.sh
bash "$persist/orca-box-ensure.sh" --install
```

The saved `orca-box-ensure-deb.sh` owns the existing backup/profile restore logic and attended deb fallback. `orca-box-ensure.sh --apply` ensures the home image, invokes the existing profile restore, and reports status. It launches no GUI. `--install-deb` explicitly invokes the old checksum-verified deb installer. An existing `/opt/Orca` remains a usable fallback if a home download fails. A failed home install returns failure and reports the available fallback; `--apply` still attempts profile recovery.

In the **Orca-only block** of `~/.local/share/box-persist/ensure.sh`, replace its direct `/opt` existence predicate with:

```bash
if "$OBE" --installed && ls "$HOME"/orca-ide-profile/Fork-5/profiles/*/profile-state.db >/dev/null 2>&1; then
  note "orca=box-ok"
```

Keep its existing background `--apply` branch. A saved home pin requires a verified home image, so an available `/opt` fallback cannot hide a missing home download. The outer ensure entry point also accepts the legacy `/opt` install before migration. Run the individual Orca ensure checks for validation; the full box ensure script also manages unrelated services and network settings.

## Updater behavior

`resources/package-type: AppImage` resolves to `non-root`. `resolveLinuxPackageDownloadedStatus` returns no package recovery for that classification. The deb/rpm **Manual Install Required → Copy Install Command** card therefore has no recovery to render for this install. Keep the artifact's original marker.

The home launcher sets `ORCA_HOME_INSTALL_MANAGED=1`. Linux x64 processes with a `non-root` classification and an absolute `APPIMAGE` named `orca-linux.AppImage` inside HOME use the shared updater. This replaces the earlier suppression policy. Startup and daily checks read the bounded `karlorz/orca` GitHub releases API, including published prereleases, and select newer numeric `vX.Y.Z-N` tags. The request sends GitHub API headers, omits session cookies, and follows GitHub asset redirects on the main-process fetch. A failed API call falls back to `releases.atom` on github.com rather than `/releases/latest`, which would skip prereleases. Non-OK responses include the URL, status, and a short body snippet. Local-build and channel-switch requests are refused for this managed install. Downloads stage beside the destination, validate through the installer's shared SHA256/marker code, and commit the image and restore pin together. The existing renderer offers **Restart to Update**. `orca update check` and `orca update apply` call the same updater: check reports feed/select/status, and apply downloads and commits the pin. Neither CLI command relaunches Orca, and apply refuses when the selected tag is older than or equal to the installed or running pin. Only an explicit user action relaunches the installed image; downloading, ordinary quit, ensure, and `orca update apply` never restart the app.

### Release daemon protocol metadata

Each future fork desktop release carries `orca-update-protocol.json`:

```json
{ "schemaVersion": 1, "tag": "v1.4.224-1", "daemonProtocol": 44 }
```

The release workflow derives `daemonProtocol` from the tagged source's `PROTOCOL_VERSION`, emits the asset before generating `SHA256SUMS.txt`, and publishes it with the existing assets. This is the only release-workflow addition. Published tags remain immutable. Older releases without metadata require attended installation.

Check, download, pre-commit, and restart compare the required protocol with the adapters that successfully answer live daemon inventory requests. Every answering generation must match. A legacy generation whose socket refuses the connection (or no longer exists) is skipped; a timeout, any other adapter error, or an inventory where nothing answered leaves the state unknown. A protocol constant from the running app alone cannot authorize installation, and an empty or unknown inventory never does. The gate has three blocking outcomes:

| Outcome                       | CLI code                               | Retryable | Meaning                                                                                                                                                                                                                                  |
| ----------------------------- | -------------------------------------- | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Attended protocol update      | `update_protocol_required`             | no        | A live daemon runs another protocol (the message names the required and live protocols), the release has no `orca-update-protocol.json` (404 or an older release), or the metadata names another tag. Follow the attended runbook below. |
| Protocol metadata unavailable | `update_protocol_metadata_unavailable` | yes       | Fetching or parsing the metadata failed (network error, non-404 HTTP status, invalid JSON). The message carries a brief cause without URLs.                                                                                              |
| Daemon state unknown          | `update_daemon_state_unknown`          | yes       | No live daemon generation could be verified. The reason is `timeout`, `adapter-error`, `none-live`, or `unavailable`.                                                                                                                    |

Retryable only means a person may run the check again. The updater never retries on its own, and download, pre-commit, and restart re-assert the gate, so a mismatch or unknown state still blocks every install step. The main process logs the blocking branch as `[updater] home AppImage gate blocked: <kind> (<reason>)`.

`orca update check|apply` probes the profile from `ORCA_USER_DATA_PATH` when set (Orca terminals and the box wrapper export it). Otherwise it reads `--user-data-dir=` from the running managed AppImage process (`/proc/<pid>` whose argv[0] or exe is the home `orca-linux.AppImage`), probing every such profile, and only then falls back to the platform default `~/.config/orca`. The unknown-state message names the probed profile and where it came from. SSH-hosted update execution remains owned by that host; this managed desktop path leaves remote service update policy intact.

### Attended daemon protocol update

For a blocked release, keep Orca running and inspect the target's protocol metadata and release notes. Save work and record the current pin, profile, launcher, and live daemon generations on the execution host. Establish the target launcher's compatibility and an explicit terminal-session migration or closure plan before crossing protocols. Download and verify the chosen immutable tag using `install-orca-home-appimage.sh --tag vX.Y.Z-N` in the attended maintenance window. Close and relaunch Orca only when the operator approves it, then verify the new version, pin, daemon protocols, and terminal reattachment. Restore the verified previous image/pin if the attended validation fails. A change that bumps daemon protocol and touches runtime-launcher files requires the reviewed `allow-runtime-launcher-protocol-bump` label.

The first production build with this updater still needs an attended installation. The next compatible fork tag is the production dogfood check; the isolated Xvfb test is the pre-merge acceptance gate.

## Sandbox, FUSE, and rollback

The box restricts user namespaces and already uses `--no-sandbox`. This launcher defaults to that flag, which reduces Chromium isolation. On a host with a working sandbox use `ORCA_HOME_NO_SANDBOX=0`. A home install cannot provision the root-owned SUID `chrome-sandbox` helper.

The packaged AppArmor profile binds `/opt/Orca/orca-ide`. The home installer leaves it and the system package intact; home launches do not inherit that path-specific allowance. Any future AppArmor change requires an attended, host-specific decision.

`APPIMAGE_EXTRACT_AND_RUN=1` is the default for hosts without usable FUSE. This invokes the original AppImage runtime, preserving `APPIMAGE`, `APPDIR`, and the package marker. Its extraction is temporary; the persisted artifact remains the AppImage. Set `APPIMAGE_EXTRACT_AND_RUN=0` to use a functioning FUSE runtime.

To use the retained system package on the next manual launch:

```bash
ORCA_HOME_USE_OPT_FALLBACK=1 ~/bin/orca-ide-newbie
```

This selects the existing `/opt` install with the same profile. The launcher clears the home updater opt-in for that process. Profile restore rules continue to refuse replacement of an existing working profile or restoration while Fork-5 is running.

## Historical verification and smoke (2026-10-10)

The following records the earlier suppression release. Current in-app update acceptance is documented in [the 2026-10-12 validation report](../audits/orca-inapp-update-validation-2026-10-12.md).

- `bash -n` on the four shell scripts and the edited box `ensure.sh`; `git diff --check`, README local link check, and pinned `oxfmt` check on the changed code/metadata.
- `ORCA_BACKGROUND_LAUNCH=1 bash config/scripts/test-orca-home-appimage.sh`: mocked release selection, paths with spaces, pinned re-download, offline repeat, bad checksum/marker/download rejection, launcher argument/profile forwarding, retained previous image, and concurrent install lock.
- Direct Node execution of `linux-home-update-policy.ts`: home opt-in accepted; deb/rpm, unusable markers, other platforms, missing/relative/outside/prefix-collision paths rejected.
- Downloaded `v1.4.222-1`: SHA256 verified, executable user-owned image, extracted marker `AppImage`. Wrapper `--version` returned `1.4.222-1`.
- Side-by-side AppImage launch on an isolated Xvfb display, with `ORCA_BACKGROUND_LAUNCH=1`, temporary HOME/config/cache/profile, and Playwright CDP readback: version `1.4.222-1`, updater status `idle`, no `linux-package-install` recovery; install-command request returned `No package install recovery is available`. Renderer screenshot captured for the smoke and removed with the temporary profile.
- Expected host warnings included missing system D-Bus and a busy live transport port (smoke used an OS-assigned port). The smoke process group was stopped and its temporary data removed. Live `/opt/Orca` retained its original PID/start time.

The smoke validates the published AppImage's startup/classification. A downloaded-update replacement, a platform Update/restore, and the new suppression behavior in a packaged future release remain unverified locally. The CI-discovered Vitest tests cover the shell contracts, policy boundaries, and managed updater actions. Full typecheck/build/regression tests are left to GitHub CI; this worktree has no installed dependencies. PR checks were absent at handoff even though the workflow and repository Actions setting were active; CI verification remains pending.
