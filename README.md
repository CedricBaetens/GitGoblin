# GitGoblin

A Windows-first Git desktop application with Fork-inspired workflows, a restrained T3 Code-style interface, and shared T3 Code conversations. Built with Tauri, Rust, Nuxt, Vue, and TypeScript.

## Development

Requires Node 22+, npm, Git, Rust stable, and (Windows) Visual Studio C++ build tools with a Windows SDK and WebView2.

```sh
npm install
npm run desktop
```

`npm run dev` opens the UI in a browser; native filesystem and Git commands require the desktop app. The browser offers an explicitly labeled example workspace for UI review.

```sh
npm run typecheck
npm run test
npm run native:test
npm run native:smoke # after building a debug desktop binary
npm run desktop:build
```

## Releases

Releases are manual-only. Pushes do not create releases or increment the version. The current app version is `0.1.0`.

Open [Actions → Release Windows](https://github.com/CedricBaetens/GitGoblin/actions/workflows/release.yml), choose **Run workflow**, select `master`, and enter the desired version (defaults to `0.1.0`). Leave **Publish immediately** unchecked to create a draft, or check it to publish after a successful build.

The workflow runs the TypeScript and Rust checks, builds the Windows x64 NSIS installer, and attaches it to a GitHub release with generated release notes. Drafts can be reviewed and published from [Releases](https://github.com/CedricBaetens/GitGoblin/releases). Existing version tags are rejected to avoid replacing a released build.

Versions are stamped into the app, package manifest, Rust manifest, and Cargo lockfile in the build checkout. The release tag points to the selected source commit; no version commit is pushed back to `master`. The workflow's built-in GitHub token publishes the release, so no personal token is needed. If repository policy blocks it, allow GitHub Actions to write repository contents.

The installer is currently unsigned; Windows may display an unknown-publisher/SmartScreen prompt. Git must be installed separately. This workflow does not configure automatic application updates.

## Product contract

GitGoblin is intended to replace Fork, including history, branches, remotes, tags, stashes, search, blame, file history, file/hunk/line staging, commits, fetch/pull/push, interactive rebase, cherry-pick, revert, reset, amend, recovery, and an integrated conflict editor.

T3 Code owns conversations and agent execution. GitGoblin connects as a paired client, associates chats with repositories/worktrees, and supports shared instructions, approvals, and live review. Chats in the same worktree share changes; Git does not attribute edits to individual chats. Ordinary code editing remains in an external editor. Git actions that change a worktree need explicit confirmation while a known agent is active.

Dedicated submodule, LFS, signing, WSL, remote-host, and public plugin interfaces are deferred. Existing Git configuration is preserved.

## Integration boundary

T3 integration uses an internal, version-sensitive protocol. It must be tested against the running server; source compatibility alone is not a successful connection proof. Pair through T3's connection settings. Credentials must never be committed, printed, or placed in browser localStorage. Git functions must remain usable without T3.

Recent repositories are saved in `repositories.json` in Tauri's per-user app data directory (`%APPDATA%/dev.gitgoblin.desktop` on Windows). Development and packaged builds share this location; startup reopens the most recent repository. Existing browser-storage history is imported when no native history exists.

T3 pairing is saved in the OS credential store (Windows Credential Manager on Windows) and restored on startup. Disconnecting forgets the saved pairing. Expired or revoked tokens require pairing again; rebuilding the app does not. Pair once with this version to persist a previously memory-only connection.

See [implementation status](docs/STATUS.md) for verified capabilities and remaining work.

The native launch scripts also find Rust in the usual per-user `.cargo/bin` directory, so an editor opened before installing Rust can still run them. Installing the Windows C++ workload requires an elevated Visual Studio Installer.
