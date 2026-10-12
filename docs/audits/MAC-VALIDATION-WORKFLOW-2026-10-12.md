# Publication-disabled exact-head Mac validation — 2026-10-12

## Scope and approval

Karl's 09:11 grant authorizes implementation, local checks, review, and one gated fork PR. A genuine signing/packaging dispatch requires fresh parent/operator approval of the complete source SHA and trusted workflow SHA. Admission API checks enforce revision equality; human review owns approval.

Diagnostics started at `e25af41d7ce6a020c032d0da3d2040fe86302de7`. PR #24 merged at `221785387c063eb241b96a730664fc89680da71e`; this branch incorporated fork-main with a normal merge. The new PR owns only workflow/shared-packaging scripts, tests, and this audit. Duplicate open workflow PR absence was checked before implementation. Draft PR: https://github.com/karlorz/orca/pull/25.

## Safety contract

- `.github/workflows/fork-mac-validation.yml:3–31` exposes manual dispatch only and read-only contents permissions. `:36–90` admits the source before template qualification and passes exactly the two existing signing secrets to the shared packaging call. The validation wrapper contains no desktop upload, release, tag, or deployment operation.
- `config/scripts/fork-mac-validation-admission.mjs:10–110` requires full lowercase 40-character source and workflow SHAs, strict build label, selected trusted workflow revision, same repository ID/owner, an open same-repository PR targeting fork-main with matching branch/head, or exact current merged fork-main with PR input 0. Unsupported source/ref formats, API errors, and drift fail closed. `:113–139` checks the trusted admission checkout and records immutable source evidence.
- `.github/workflows/fork-mac-package.yml:47–71` checks out immutable source and trusted admission code separately with credentials persistence disabled. `:120–134` refetches live source and trusted workflow head immediately before the first secret-bearing step. Source composites and build/signing scripts are part of the reviewed source; local reusable workflow definitions resolve from the trusted caller revision.
- `node-server-tests.yml:62–65,469–523` receives the exact source ref and preserves all persistence/glibc/musl matrix gates. Its successful template includes provenance from the source checkout; validation verifies and removes that evidence file before packaging, preserving the shipped template inventory. `fork-mac-template-provenance.mjs` binds repository, source SHA, run ID, attempt, and SHA-256 of `orcad-template.json`. The existing template verifier checks payload checksums. Download supplies only name/path, using the current run; stale/cross-run fallback is absent.
- `fork-mac-package.yml:147–173` uses the existing self-signed identity and `--mac --publish never`, requires the deployment template, and records pipeline failures with pipefail. `:198–223` stages and uploads Mac desktop assets only when validation is false; shared job admission requires tag push for that release mode.
- `fork-macos-trust-self-signed-identity.sh:15–20` confines decoded identity to private runner-temp storage with mode 0700/umask 077. `fork-macos-cleanup-identity.sh:4–29` restores the saved keychain search list and deletes the temporary keychain and p12. An always-run cleanup step reports failure in the public-safe summary. Abrupt runner termination can prevent cleanup; the hosted ephemeral runner remains the final containment boundary. Signing secrets remain step-scoped.

## Packaging parity and actual Mac evidence

Release `build-mac` calls the same packaging workflow with original tag-derived label and source SHA. The pinned `macos-15` runner, 90-minute timeout, dependency composites, x64/arm64 variants, fork version, desktop/native builds, Electron runtime preparation, template requirement, identity, archive names, updater manifests, blockmaps, and publication dependency remain present. Linux/Windows jobs and publication metadata remain byte-equivalent in parsed job content.

Identity import occurs after building inputs and downloading/verifying the template, allowing the live head recheck immediately before privileged signing. Both app signatures and executable speech helpers are now checked. Validation verifies archives directly in dist; the release retains its original staging verification and artifact name.

`config/electron-builder.config.cjs:890–912`, `config/scripts/verify-packaged-daemon-entry.cjs:325–359`, and the privacy diagnostics remain unchanged. The existing afterPack gate executes isolated signed helper clones on x64/Rosetta and arm64, requires computed `OK 42` within 20 seconds, and verifies helper signatures. `verify-fork-mac-package.mjs:6–39` requires each architecture's actual existing PTY and helper-signature success lines plus both outer app authorities. Missing/skipped slice evidence fails packaging. A successful summary identifies workflow SHA, source SHA, run/attempt, package outcome, and cleanup outcome. Failure logs retain the existing bounded privacy-safe diagnostics; desktop artifacts are withheld.

## Local verification

Explicit glibc Node 24.21.0, `ORCA_BACKGROUND_LAUNCH=1`, serial `heavy-run` with 2048 MiB memory floor, and Vitest `--maxWorkers=1` are used. The heavy cgroup is unavailable; heavy-run retains low-priority settings.

- Frozen root dependencies with scripts disabled: passed.
- `pnpm run build:packages`: passed.
- Initial five focused contract suites: **164/164 passed**. Admission/provenance fixtures, manual permission/secret gates, both-slice evidence, release workflow, mobile packaging census, and CPU download-cache contracts executed.
- Shell syntax: passed for trust and cleanup scripts.
- Expanded regression run: **17 suites, 249 passed, 10 existing platform-dependent skips**. Includes Node >=24 boundary, privacy diagnostics, template inventory/matrix, release archives/version, both mocked app signatures, and mocked identity import/cleanup failure handling. Mocked security commands use fixture p12/password strings and perform no signing.
- Existing verifier suite with one explicit native-binding exclusion: **15 passed, 1 skipped**. Excluded test: `executes computed output through the real PTY after a profile reads during startup`; this script-free install has no rebuilt `pty.node`. No dependency scratch/native copying was performed. Deadline, literal-echo rejection, command delivery, ACK diagnostics, and cleanup fixtures executed.
- Final `ORCA_CODE_QUALITY_BASE=fork/fork-main pnpm run check:code-quality:changed`: passed with **zero new findings across 11 changed code files**, including native/type-aware/casting and design-system scans. Scoped formatting, shell syntax, and `git diff --check`: passed.
- Independent source parity check compared parsed `verify`, template caller, Linux, Windows, and publication jobs with fork-main: equivalent. Template jobs/matrices/gates are equivalent after removing the optional provenance step. Packager configuration, actual helper clone/verifier, helper signature checker, and privacy diagnostic implementation are byte-unchanged.
- The worker reviewed the complete changed diff locally. The parent coordinator received draft PR #25 early and owns independent final review. No nested agents were launched.
- Full application build, full typecheck, and full test matrix remain ordinary CI gates. Local internal-package build passed; Mac packaging awaits separate execution approval.
- Genuine signed macOS, Rosetta, and arm64 packaging: pending fresh exact-head execution approval. Local fixture checks supply no Mac execution evidence.

## Dispatch command draft — pending fresh parent approval

The operator must first review both complete revisions, ensure this workflow is available on the repository default branch, and confirm the selected trusted branch still resolves to the reviewed workflow SHA. GitHub dispatch availability and any protected-environment enforcement must be verified by the operator. This implementation supplies an admission boundary; an unconfigured environment supplies no approval enforcement.

```bash
# DRAFT ONLY: all placeholders pending fresh parent/operator approval.
gh workflow run fork-mac-validation.yml --repo karlorz/orca \
  --ref '<PARENT_APPROVED_TRUSTED_WORKFLOW_BRANCH>' \
  -f workflow_sha='<REVIEWED_TRUSTED_WORKFLOW_FULL_40_CHARACTER_SHA>' \
  -f source_sha='<REVIEWED_SOURCE_FULL_40_CHARACTER_SHA>' \
  -f source_pr='<OPEN_SAME_REPOSITORY_PR_NUMBER_OR_0_FOR_MERGED_FORK_MAIN>' \
  -f source_branch='<EXACT_REVIEWED_PR_BRANCH_OR_FORK_MAIN>' \
  -f build_label='v1.4.224-3'
```

The label is isolated local metadata and performs no tag operation. A new source/workflow head requires fresh review and approval. Parent owns ordinary CI observation, final diff review, signing authorization, merge, and future release gates. This worker performs no signing dispatch, CI rerun, Mac access, GUI/install, tag, release, deployment, or merge of this PR.
