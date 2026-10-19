# Implementation status

The agreed release goal is a usable Fork replacement. An intermediate foundation is not the finished product.

## Delivery order

1. Native Nuxt/Tauri packaging and a real shared T3 conversation proof.
2. Daily Git review and operations with repository/worktree navigation.
3. Advanced history editing, conflicts, and recovery.
4. Disposable-repository tests, reconnect tests, and daily-use UI validation.

## Implemented

- Nuxt 4 / Vue 3 client-rendered UI, Tauri 2 shell, app icons, and static packaging configuration.
- Repository and worktree navigation, polling, staged/unstaged/branch review, line/hunk/file staging, commit/amend, history ancestry graph, search, file history, blame, and reflog recovery.
- Rust command boundary for branches, tags, remotes, fetch/pull/push, stash, merge, cherry-pick, revert, reset, linear interactive rebase, and conflict editing/continue/abort.
- File fingerprints for stale-review checks. Whole-file staging captures reviewed bytes before writing the index. Git arguments are passed without a shell; mutation requests are serialized.
- T3 local pairing, ticketed WebSocket RPC, shell/thread subscriptions, conversation navigation, prompt/context sending, create/stop controls, approval response controls, per-chat drafts and review-position memory.
- The top bar’s labeled “New conversation” button opens large action buttons for Blank, Triage ticket (`/triage`), Implement ticket (`/implement`), Debug (`/diagnosing-bugs`), and Review changes (`/code-review`). Triage and Implement show a required Ticket field accepting a URL, number, or pasted description, which carries into the editable instruction. Project, model, and worktree default to the current context. The “Use new worktree” toggle automatically creates a uniquely named branch and folder from HEAD before opening the editable draft; a failed T3 creation can retry using the created worktree. First sends request T3 title generation on both protocols; no manual title is required. Skill execution and tracker setup remain owned by the paired agent environment.
- Global repository opening lives in File → Open repository (Ctrl O); the repository switcher only switches saved repositories. Duplicate opening controls, the chat-header Disconnect action, and the local/branch comparison toggle are removed. Branch-context comparisons remain available; choosing Local changes in the sidebar returns to the working directory.
- Commit is a top-bar action that uses the selected conversation in the current worktree to inspect the staged diff and recent history, generate the message, run relevant checks, and commit; it creates a conversation only when none is selected for that worktree. Existing composer drafts are preserved. It receives the expected HEAD and exact staged blob/path snapshot and must stop if either changes. Manual message entry and amend are secondary menu actions; the permanent commit form is removed. Automatic commits require paired T3; manual commits remain local.
- Ticket presets show active Azure DevOps tickets assigned to the signed-in user and search project tickets by ID or title. The project is inferred from the selected worktree’s Azure origin; queries reuse the installed Azure CLI and Azure DevOps extension, keeping credentials in that environment. Selecting a result fills its full work-item URL. Manual references/descriptions remain available, including for other trackers. Search displays up to 30 results and ignores stale responses when the project or query changes.
- Reconnects refresh subscriptions without replaying mutations. Credentials remain behind the native boundary and persist in the OS credential store; Git functionality does not require T3.
- Keyboard-accessible dialogs and an explicit, non-mutating example workspace for browser review.

## Verification as of 2026-10-16

- `pnpm typecheck`: passed.
- `pnpm build`: static Nuxt production build passed (Nuxt reports an upstream cache-driver warning).
- `pnpm test`: 16 tests passed. Ten use real disposable Git repositories for partial staging/unstaging (including new/deleted files and missing final newlines); five test T3 transport/pairing/reconnect behavior with a simulated server; one verifies ancestry lanes.
- Shared-browser checks: example workspace opens, diff context attaches to chat, and the history graph renders. No document-level horizontal overflow at 1600px. Screenshot/recording tools currently fail in the host preview, so pixel-level visual inspection remains pending.
- Windows C++ toolchain installed. Fixed the operation continue/abort argument type mismatch. Native compilation succeeds; all five native tests pass.
- Native smoke test passes against the actual debug executable and temporary repositories: staging, commits, history, revert, reset, stash, branches, cherry-pick, interactive rebase, tags, worktrees, and reflog.
- Local T3 server detected. Its unauthenticated endpoint correctly requires pairing. No live paired-session proof has run; protocol tests do not establish installed-server compatibility.

## Remaining before replacing Fork

1. Validate desktop launch and native UI workflows on Windows; automated native unit and smoke tests now pass.
2. Exercise a real paired T3 session, including a message/response and approval visible in both apps.
3. Verify native UI behavior, conflict workflows, repository refresh while agents edit, and large-history performance on real repositories.
4. Review release limitations: history loads in 500-commit pages with virtualized rows; file history/blame are textual views; merge-containing interactive-rebase ranges are rejected; reword uses pause/amend/continue; pull is fast-forward-only; push requires configured tracking; no force-push UI; binary conflicts require an external editor; expired or revoked T3 credentials require pairing again; structured agent questions are handled in T3.

This is an unverified desktop alpha, not yet a validated Fork replacement. The release goal remains unchanged.

### Persistence verification

Repository history now uses the stable per-user app data directory, migrates legacy browser history, and reopens the latest repository. T3 pairing restores from the OS credential store; explicit disconnect deletes it. Type checking, 16 frontend tests, and 7 native tests pass, including repository save/reload/replacement and credential lifecycle tests with a mock store. A live paired T3 restart and packaged/development round trip have not been exercised.


### Compact workspace and diff responsiveness

The integrated titlebar includes repository switching and native window controls. Change lists support compact tree/list layouts, file double-click staging, and folder staging. Diffs offer unified/side-by-side layouts and optional whole-file context; commit input is collapsed until editing. Cached/prefetched diffs and concurrent native reads reduce selection latency. Background refresh preserves unchanged state and hunk controls retain their geometry while loading.

Validation: 31 frontend tests, 10 native tests, type checking, and production build pass. Browser checks covered repository selection, compact rows, folder path selection, side-by-side rendering, and identical hunk/header positions before/during/after loading. Native window behavior still needs a desktop restart and hands-on verification. First uncached diffs still depend on repository/file size.

The installed T3 0.0.45 bundle uses the legacy turn protocol; the reference checkout uses the newer message protocol. GitGoblin now distinguishes their shell snapshots, sends the corresponding commands, accepts legacy message snapshots/stream updates, and displays string rejection reasons. Both protocol paths are covered with simulated sockets. No live message was sent during verification; live sending and approval workflows still need verification.


### Compact paginated history

History uses 22-pixel rows with continuous ancestry lines/dots, refs before the subject, and aligned author, hash, and timestamp columns. It starts with 500 commits and loads older pages near the scroll boundary or via the explicit button. Only viewport rows are mounted. Search resets pagination; unchanged refreshes retain older loaded pages. Validation: 35 frontend tests, 11 native tests, type checking, and production build pass. Browser checks exercised 1,000 commits, 22-pixel graph continuity, and both pagination triggers. Native pagination/filter tests use disposable Git history beyond 150 commits. Large real-repository desktop performance remains unmeasured.
