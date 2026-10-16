# GitGoblin: Windows desktop Git client with shared T3 Code conversations

## Problem Statement

Cedric currently uses Fork to inspect and manage Git repositories while developing with AI agents in T3 Code. Fork's workflow is familiar, but its interface and integration cannot be extended to fit this workflow. Moving between Git review and multiple agent conversations makes it harder to understand changes, preserve review context, and give targeted instructions.

GitGoblin must become Cedric's daily desktop Git application and replace Fork. A browser mockup or an unverified collection of Git commands does not meet that goal.

## Solution

Build a Windows-first Tauri desktop application with a Nuxt/Vue interface and a Rust native backend. Preserve the useful organization of Fork while adopting a modern, professional visual style inspired by T3 Code. Keep repositories, worktrees, changes, history, and shared agent conversations together.

The user keeps GitGoblin open while developing, reviews live changes, switches between conversations without losing context, and sends instructions or approval responses that are also visible in T3 Code. Git remains usable independently of T3 Code. Cross-platform portability is desirable; Windows is the first release target.

## User Stories

1. As a developer, I want GitGoblin to launch in its own Windows desktop window, so that I can use it as my daily Git client.
2. As a Fork user, I want familiar repository, branch, history, and staging workflows, so that switching clients does not disrupt my work.
3. As a developer, I want a polished interface inspired by T3 Code, so that reviewing code and conversations feels consistent.
4. As a developer, I want to open local repositories and return to recent repositories, so that I can move between projects quickly.
5. As a developer, I want to inspect and switch worktrees, so that parallel development remains understandable.
6. As a developer, I want to create worktrees, so that separate tasks can use separate working directories.
7. As a developer, I want to see unstaged and staged changes separately, so that I know what the next commit includes.
8. As a developer, I want to review committed branch changes as well as uncommitted changes, so that I can assess an entire task.
9. As a developer, I want live changes to refresh without losing my selected file or scroll position, so that agent edits do not interrupt review.
10. As a developer, I want to stage and unstage whole files, so that I can assemble commits efficiently.
11. As a developer, I want to stage and unstage individual hunks and lines, so that unrelated edits can become separate commits.
12. As a developer, I want stale review actions to be rejected clearly, so that I do not accidentally stage content different from what I reviewed.
13. As a developer, I want to write commit messages and commit staged changes, so that I can record focused units of work.
14. As a developer, I want to amend the previous commit, so that I can correct its message or contents.
15. As a developer, I want an ancestry graph and searchable history, so that I can understand how changes reached a branch.
16. As a developer, I want to inspect a commit's changes, so that I can review its purpose and effect.
17. As a developer, I want file history and blame, so that I can trace the origin of particular changes.
18. As a developer, I want to create and manage branches, so that I can organize development tasks.
19. As a developer, I want to manage remotes and tags, so that I can work with upstream repositories and release markers.
20. As a developer, I want to fetch, pull, and push, so that I can synchronize with remote repositories.
21. As a developer, I want to create, apply, and manage stashes, so that I can temporarily set aside unfinished work.
22. As a developer, I want to merge branches, so that I can integrate completed work.
23. As a developer, I want to cherry-pick commits, so that I can reuse selected changes on another branch.
24. As a developer, I want to revert commits, so that I can undo changes through explicit history.
25. As a developer, I want reset operations with clear consequences, so that I can move a branch deliberately.
26. As a developer, I want interactive rebase with reorder, squash, fixup, reword, and drop, so that I can prepare readable history.
27. As a developer, I want an integrated conflict editor, so that I can resolve text conflicts while seeing Git operation state.
28. As a developer, I want to continue or abort an interrupted Git operation, so that I can complete it or return to a known state.
29. As a developer, I want reflog inspection and recovery, so that I can recover from mistaken history operations.
30. As a developer, I want ordinary files to open in my external editor, so that GitGoblin fits my existing editing workflow.
31. As a developer, I want multiple T3 Code conversations visible in GitGoblin, so that I can follow parallel agent tasks.
32. As a developer, I want to create and select shared conversations, so that I can begin and continue tasks from GitGoblin.
33. As a developer, I want conversations associated with repositories and worktrees, so that selecting a chat opens the relevant review context.
34. As a developer, I want each conversation to retain its draft and review position, so that switching tasks does not discard my place.
35. As a developer, I want to send instructions from GitGoblin and see them in T3 Code, so that both apps represent the same conversation.
36. As a developer, I want responses and activity started in T3 Code to appear in GitGoblin, so that I can keep reviewing while an agent works.
37. As a developer, I want to attach selected diff context to an instruction, so that an agent knows exactly which changes I mean.
38. As a developer, I want to stop an agent and respond to supported approval requests, so that I can control execution beside the diff.
39. As a developer, I want chats sharing a worktree to show the same Git changes, so that the interface does not invent ownership of edits.
40. As a developer, I want warnings before committing or changing worktree state while a known agent is running, so that I can coordinate competing actions.
41. As a developer, I want to collapse the conversation panel, so that I can dedicate more space to Git review.
42. As a developer, I want Git operations to remain usable when T3 Code is disconnected, so that agent availability does not block development.
43. As a developer, I want reconnects to restore current conversations without resending commands, so that temporary disconnects do not duplicate work.
44. As a developer, I want pairing credentials kept out of source files, logs, and browser storage, so that connecting the apps does not expose access tokens.
45. As a developer, I want keyboard-accessible navigation and dialogs, so that common workflows remain efficient.
46. As a developer, I want actionable errors and visible operation state, so that I understand failures and can recover.
47. As the initial user, I want the architecture to support future extensions, so that I can add personal features without replacing the application.
48. As a developer, I want the preview clearly identified as example data, so that I can distinguish UI exploration from real desktop testing.

## Implementation Decisions

- The product is a native desktop application, using Tauri 2 and Rust with client-rendered Nuxt, Vue, and TypeScript. The browser preview is an explicitly labeled, non-mutating UI demonstration, not the production execution environment.
- Windows is the primary target. Keep platform-specific behavior isolated where practical, without making macOS, Linux, or WSL support a prerequisite for this release.
- Organize the interface around repository/worktree/conversation navigation, a central changes or history workspace, and a collapsible conversation panel. Fork informs workflow organization; T3 Code informs visual style.
- Extend the existing native Git command boundary, workbench state, diff viewer, history graph, and T3 client rather than creating parallel implementations.
- Execute structured Git requests without a shell. Validate paths and references, serialize mutations, and surface Git operation state and errors. Preserve existing Git configuration.
- Capture reviewed content for whole-file staging and detect stale reviews before mutation. Partial staging must correctly handle new/deleted files and missing final newlines.
- Repository and worktree state owns Git changes. Conversation state owns drafts and review position. Conversations sharing a worktree share its changes; no per-agent attribution is inferred from Git.
- T3 Code owns agent execution and conversation history. GitGoblin is a paired client of the same backend, not a second agent runtime or a copy of chat history.
- Use the existing pairing, ticketed WebSocket subscription, and command adapter. The internal T3 protocol is version-sensitive; prove compatibility against the installed server and show clear connection failures.
- Keep pairing credentials in native memory. Reconnect by resubscribing and refreshing state; never automatically replay mutations. Persistence across app restarts is not a first-release requirement.
- Support shared message sending, thread creation/selection, interrupt, and supported approval responses. Route unsupported structured agent questions to T3 Code until explicitly implemented.
- Keep ordinary code editing in an external editor; provide in-app text conflict resolution and instruction editing.
- Warn and require deliberate confirmation for relevant commits/worktree changes while an associated agent is known to be active. This is coordination based on observed activity, not a guarantee of exclusive access.
- Refresh state without resetting review selection and scroll. Avoid applying stale asynchronous results after the user changes repository, worktree, or conversation.
- Deliver and validate the native package and shared-conversation proof before treating broad Git feature presence as completion. Then validate daily Git operations, advanced history/conflicts/recovery, and sustained daily use.
- No public plugin framework or additional database schema is required by the agreed scope.

## Testing Decisions

- The user confirmed these seams: real Git behavior through the existing native command boundary on disposable repositories; T3 behavior through the existing client plus a live shared session; desktop launch and primary workflows through the real application.
- Good tests assert observable results: repository contents, index entries, commit ancestry, operation status, visible conversation state, or actionable errors. Avoid tests of private helpers that only mirror implementation.
- Prefer the existing debug native request harness as the highest practical automated Git seam. Exercise the real executable against temporary repositories and local bare remotes, inspecting results with Git. Do not use personal repositories for destructive test cases.
- Cover staging/unstaging, commits/amend, branch/worktree operations, remotes, stash, merge, cherry-pick, revert, reset, interactive rebase, conflict continue/abort, and reflog recovery. Include stale reviewed content and edits arriving during review.
- Existing partial-patch tests already use disposable Git repositories, including new/deleted files and missing final newlines. Reuse this approach for meaningful edge cases; avoid duplicating every assertion at multiple layers.
- Existing T3 transport tests use simulated WebSocket responses. Extend that seam for pairing failures, subscriptions, reconnect state, and prevention of duplicate mutation dispatch.
- Simulated transport tests are insufficient for acceptance. Pair with a real T3 server and verify messages, responses, interruption, and approvals are reflected in both apps, including switching between multiple conversations/worktrees.
- Test native launch, opening a repository, reviewing/staging/committing a change, external file opening, conflict resolution, and conversation interaction in the Windows desktop window. Browser checks establish UI behavior only.
- Verify keyboard focus, dialog dismissal, panel resizing/collapse, retained review context during updates, and usable history behavior on larger repositories. No numeric performance target was agreed; record observed results rather than inventing a benchmark requirement.
- Run TypeScript checks, frontend tests/build, Rust compilation and native tests. Native acceptance requires the Windows C++ toolchain, Windows SDK, and WebView2. A successful frontend build does not establish a successful desktop build.

## Out of Scope

- A browser-based Git client or hosted replacement for the desktop app.
- A separate agent execution service or independent copy of T3 conversations.
- A general-purpose in-app code editor beyond conflict resolution and instruction composition.
- Dedicated submodule, Git LFS, and signing interfaces for the initial release.
- First-release WSL support, remote development connections, or full cross-platform parity.
- A public plugin ecosystem, multi-user product rollout, or marketplace.
- Automatic attribution of worktree changes to individual conversations or agents.

## Further Notes

The initial alpha was committed as 8bff492 on master. Frontend typechecking, a static production build, and 16 tests passed during implementation. These results are not evidence of native correctness or live T3 interoperability.

The initial native build was blocked by a missing MSVC linker. The user subsequently installed the toolchain and compilation reached the application code, exposing a string-reference type mismatch in operation continuation/abort. That mismatch has been corrected. All five native tests and the native executable smoke test now pass, including staging, commits, history, revert, reset, stash, branches, cherry-pick, interactive rebase, tags, worktrees, and reflog. Desktop UI acceptance remains pending. A real paired T3 session has not yet been demonstrated.

Current implementation constraints include a 150-commit history limit, textual file-history/blame views, rejection of merge-containing interactive rebases, pause/amend/continue for reword, fast-forward-only pull, push requiring tracking, no force-push interface, external handling of binary conflicts, re-pairing after restart, and routing structured agent questions to T3 Code. These are current limitations to assess against daily replacement workflows, not blanket evidence that the release goal is complete.

Completion means a validated Windows desktop workflow that Cedric can actually use instead of Fork, including shared T3 conversation control. Build success and source-level feature presence alone do not meet that acceptance bar.
