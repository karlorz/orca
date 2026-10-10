# Linux home AppImage install

This box-specific path installs the `karlorz/orca` desktop AppImage under the user's home directory. It survives **Update Bot's Computer**, which preserves `/home/box` and `/workspace`. The install script uses no root commands and launches no GUI.

## Paths and ownership

| File | Purpose |
| --- | --- |
| `~/.local/opt/orca/orca-linux.AppImage` | Current executable, owned and writable by the user |
| `~/.local/opt/orca/release-tag` | Exact fork desktop version to restore |
| `~/.local/opt/orca/appimage.sha256` | Verified checksum of the installed image |
| `~/.local/opt/orca/orca-linux.AppImage.previous` | One previous image, with matching `.previous` tag/checksum files |
| `~/bin/orca-ide-newbie` | AppImage launcher, display defaults to `:5` |
| `~/orca-ide-profile/Fork-5` | Existing profile, passed as `--user-data-dir` for GUI launches |
| `~/.local/share/box-persist/` | Persistent installer and ensure scripts |

The shell launcher preserves `ORCA_USER_DATA_PATH` for CLI calls. The existing dock/desktop entries already call `~/bin/orca-ide-newbie`. `~/bin` should be on `PATH`; invoking the full path also works. The published fork AppImage asset currently targets Linux x86_64; the installer refuses other hosts. Run installation and ensure on the execution host when using SSH.

## First install

From the fork checkout:

```bash
bash config/scripts/install-orca-home-appimage.sh --latest
```

Requirements: Bash, `gh`, Node (for latest-release selection), `sha256sum`, and `flock`. Downloads use GitHub CLI authentication already configured on the host. The installer selects the highest numbered published `vX.Y.Z-N` fork desktop release in the latest 100 releases with both `orca-linux.AppImage` and `SHA256SUMS.txt`. Published prereleases are eligible. Mobile tags, upstream mirror tags, drafts, and incomplete releases are excluded; use `--tag` if the desired release falls outside that bounded list.

Download and validation happen in a staging directory beside the destination. The script verifies exactly one checksum entry and extracts only `resources/package-type` to require `AppImage`. It switches the image and launcher only after validation. It retains one previous image and backs up the original launcher as `~/bin/orca-ide-newbie.pre-appimage`. A lock prevents overlapping installs.

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

`--ensure` saves a release pin on first install. Later runs use that pin. Checksum disagreement, invalid marker, download failure, or an invalid tag abort before replacing the current install. A pending-switch marker makes an interrupted switch fail the health check, including interruptions between checksum and pin updates. The next ensure run repairs from the saved tag. Only a healthy previous image replaces the rollback copy.

## Box persistence integration

Preserve the current box-specific profile restore implementation, then install the small home-aware entry point beside it:

```bash
persist="$HOME/.local/share/box-persist"
mkdir -p "$persist"
if [ ! -e "$persist/orca-box-ensure-deb.sh" ]; then
  cp -p "$persist/orca-box-ensure.sh" "$persist/orca-box-ensure-deb.sh"
fi
cp config/scripts/install-orca-home-appimage.sh \
   config/scripts/orca-home-launcher.sh \
   config/scripts/orca-box-ensure.sh "$persist/"
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

The home launcher sets `ORCA_HOME_INSTALL_MANAGED=1`. Releases containing this PR honor it only on Linux, with a `non-root` classification and an absolute `APPIMAGE` path inside home. Those processes skip automatic updater setup and checks, reject in-app downloads/restarts, and show guidance for the ensure installer when the user checks for updates. Ordinary AppImages and system deb/rpm installs retain their existing update behavior. The ensure script owns version changes and repair for the managed launcher.

**Release boundary:** `v1.4.222-1` predates this opt-in. The installed image currently keeps its existing AppImage updater. While the saved pin owns restore, use the ensure installer to change versions and leave the in-app Download/Restart actions unused. If an old build updates itself, ensure detects checksum disagreement and restores the saved pin. Full in-app suppression needs a new fork release containing the policy change. This PR creates no release tag.

## Sandbox, FUSE, and rollback

The box restricts user namespaces and already uses `--no-sandbox`. This launcher defaults to that flag, which reduces Chromium isolation. On a host with a working sandbox use `ORCA_HOME_NO_SANDBOX=0`. A home install cannot provision the root-owned SUID `chrome-sandbox` helper.

The packaged AppArmor profile binds `/opt/Orca/orca-ide`. The home installer leaves it and the system package intact; home launches do not inherit that path-specific allowance. Any future AppArmor change requires an attended, host-specific decision.

`APPIMAGE_EXTRACT_AND_RUN=1` is the default for hosts without usable FUSE. This invokes the original AppImage runtime, preserving `APPIMAGE`, `APPDIR`, and the package marker. Its extraction is temporary; the persisted artifact remains the AppImage. Set `APPIMAGE_EXTRACT_AND_RUN=0` to use a functioning FUSE runtime.

To use the retained system package on the next manual launch:

```bash
ORCA_HOME_USE_OPT_FALLBACK=1 ~/bin/orca-ide-newbie
```

This selects the existing `/opt` install with the same profile. The launcher clears the home updater opt-in for that process. Profile restore rules continue to refuse replacement of an existing working profile or restoration while Fork-5 is running.

## Light verification and smoke (2026-10-10)

- `bash -n` on the four shell scripts and the edited box `ensure.sh`; `git diff --check`, README local link check, and pinned `oxfmt` check on the changed code/metadata.
- `ORCA_BACKGROUND_LAUNCH=1 bash config/scripts/test-orca-home-appimage.sh`: mocked release selection, paths with spaces, pinned re-download, offline repeat, bad checksum/marker/download rejection, launcher argument/profile forwarding, retained previous image, and concurrent install lock.
- Direct Node execution of `linux-home-update-policy.ts`: home opt-in accepted; deb/rpm, unusable markers, other platforms, missing/relative/outside/prefix-collision paths rejected.
- Downloaded `v1.4.222-1`: SHA256 verified, executable user-owned image, extracted marker `AppImage`. Wrapper `--version` returned `1.4.222-1`.
- Side-by-side AppImage launch on an isolated Xvfb display, with `ORCA_BACKGROUND_LAUNCH=1`, temporary HOME/config/cache/profile, and Playwright CDP readback: version `1.4.222-1`, updater status `idle`, no `linux-package-install` recovery; install-command request returned `No package install recovery is available`. Renderer screenshot captured for the smoke and removed with the temporary profile.
- Expected host warnings included missing system D-Bus and a busy live transport port (smoke used an OS-assigned port). The smoke process group was stopped and its temporary data removed. Live `/opt/Orca` retained its original PID/start time.

The smoke validates the published AppImage's startup/classification. A downloaded-update replacement, a platform Update/restore, and the new suppression behavior in a packaged future release remain unverified locally. The CI-discovered Vitest tests cover the shell contracts, policy boundaries, and managed updater actions. Full typecheck/build/regression tests are left to GitHub CI; this worktree has no installed dependencies. PR checks were absent at handoff even though the workflow and repository Actions setting were active; CI verification remains pending.
