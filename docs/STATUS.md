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
- Reconnects refresh subscriptions without replaying mutations. Credentials stay in Rust memory; Git functionality does not require T3.
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
4. Review release limitations: history currently loads up to 150 matching commits; file history/blame are textual views; merge-containing interactive-rebase ranges are rejected; reword uses pause/amend/continue; pull is fast-forward-only; push requires configured tracking; no force-push UI; binary conflicts require an external editor; T3 credentials require pairing again after restart; structured agent questions are handled in T3.

This is an unverified desktop alpha, not yet a validated Fork replacement. The release goal remains unchanged.
