# Managed home AppImage updater validation

Date: 2026-10-12. Branch: `karlorz/orca-inapp-update`, based on `2ba56e7cfcb` (`fork-main`). Scope: updater replacement for the earlier managed-home suppression policy.

## Acceptance evidence

The fully automated Xvfb test completed successfully. It used disposable HOME, XDG config/cache/runtime and profile directories, `ORCA_BACKGROUND_LAUNCH=1`, hidden renderers, Playwright CDP, and two actual AppImages repackaged from the checksum-verified `v1.4.224-1` asset, including its required SSH deployment template. Current main/daemon and preload bundles were overlaid on the existing packaged renderer. The test artifact changes package version and redirects only the HTTP transport to a local release fixture. Production code has no test feed override. The fixture release is a published prerelease with matching protocol metadata.

Result:

```json
{
  "oldVersion": "1.4.224-0",
  "newVersion": "1.4.224-1",
  "steps": [
    "old image installed and pin verified",
    "old version running in isolated HOME/profile on Xvfb",
    "in-app check selected newer fork prerelease with matching live daemon protocol",
    "verified download swapped image, retained verified previous image and wrote matching pin; old process still running",
    "explicit Restart to Update click relaunched new version with same isolated profile and current pin"
  ],
  "pass": true
}
```

The test clicks the production General settings Check for Updates, Download Update and Restart to Update buttons. It asserts current image digest, previous image digest and release pin before restart; it reads the old process's version after swap to prove the download itself did not restart the application. After the click it reconnects to the new process and verifies version and pin. It terminates only processes whose environment contains its disposable HOME, then removes the test profile. The live GUI and live home install were untouched.

Earlier complete journeys also passed against the initial base before the required-template guard was added. The first two needed education-modal dismissal through CDP. The final rig seeds all feature tips and waits for settings to render, so its 32-second run needs no intervention. A test-setup race briefly clicked a broad Close selector before General settings rendered; the selector was removed and the fully automated run passed. This was a fixture issue.

## Reproduction

Run from this worktree with Node 24, the pinned dependencies and process-host built. Run heavy commands serially through the host's `heavy-run` guard. Download the base AppImage and `SHA256SUMS.txt` into temporary storage and verify the exact AppImage entry before repackaging.

```bash
ORCA_BACKGROUND_LAUNCH=1 ORCA_ELECTRON_VITE_TARGET=main \
  node config/scripts/run-electron-vite-build.mjs \
  --config config/electron-vite-target.config.cts --ignoreConfigWarning --mode e2e
ORCA_BACKGROUND_LAUNCH=1 ORCA_ELECTRON_VITE_TARGET=preload \
  node config/scripts/run-electron-vite-build.mjs \
  --config config/electron-vite-target.config.cts --ignoreConfigWarning --mode e2e
ORCA_BACKGROUND_LAUNCH=1 node config/scripts/home-appimage-xvfb-fixtures.mjs \
  /tmp/verified-base/orca-linux.AppImage /tmp/orca-update-fixtures
ORCA_BACKGROUND_LAUNCH=1 xvfb-run -a node config/scripts/home-appimage-xvfb-test.mjs \
  /tmp/orca-update-fixtures/fixture-0.AppImage \
  /tmp/orca-update-fixtures/fixture-1.AppImage \
  /tmp/orca-update-fixtures/result.json
```

The fixture packager requires a fresh directory under `/tmp`. The result includes the exact path steps and `pass`; failure captures its own app log. The restart screenshot is test output and stays outside git. Remove owned temporary artifacts after collecting evidence.

## Local verification

- Focused Vitest suite: **57 tests passed across six files** (`orca-home-appimage-install.test.ts`, `orca-home-appimage.test.mjs`, home release policy/updater tests, Linux managed-home policy and updater startup scheduling tests).
- Transaction tests cover journal, image, checksum, pin and identity publication interruption boundaries; missing/corrupt/stale pins; unknown image identity; numeric suffix ordering; a newer pin committed by a competing actor; exact-one checksums; package markers and missing required deployment templates; one verified previous image; exclusive lock and immutable tag bytes.
- Main bundle and E2E preload builds passed. Production main bundle includes shared installer logic without a runtime Node dependency.
- Strict bounded TypeScript check for new core modules passed. The shared standalone TypeScript file is included in the main composite project.
- Changed-lines code-quality gate against `origin/fork-main`, focused oxlint, `bash -n`, and `git diff --check` passed.
- Protocol metadata generation returned `{"schemaVersion":1,"tag":"v1.4.224-1","daemonProtocol":44}`. Release workflow adds only this asset before the existing SHA256SUMS generation.

## Limitations and operator follow-up

The full repository TypeScript run was stopped after pushing MemAvailable below the host guard floor; the coordinator confirmed memory pressure. Full typecheck and cross-platform/regression/build checks remain CI responsibilities. No protocol bump or runtime-launcher change is included. Older releases lacking protocol metadata require an attended installation.

A filesystem has no multi-file atomic rename. The journal makes the image and pin a recoverable transaction: recovery finishes verified target bytes before repair decisions. A crash leaves `.install-lock` in place. An attended operator must establish owner exit, remove that specific lock and invoke ensure; the updater never guesses process death.

The initial production install and next compatible fork-tag dogfood check remain attended and outside this task. Karl owns merge and release.
