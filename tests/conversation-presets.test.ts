import { describe, expect, it } from "vitest";
import { conversationDefaults, conversationPresets, conversationPrompt, newConversationWorktree } from "../app/lib/conversation-presets";
import type { T3Project, T3Thread } from "../app/lib/types";

const model = { instanceId: "codex", model: "gpt-6" };
const projects: T3Project[] = [
  { id: "other", workspaceRoot: "D:/other", defaultModelSelection: model },
  { id: "current", workspaceRoot: "D:/repo", defaultModelSelection: model },
];

describe("conversation starters", () => {
  it("carries a ticket reference or full description into ticket drafts without leaking it to other actions", () => {
    expect(conversationPrompt(conversationPresets[1], ' #42 ')).toBe('/triage #42');
    expect(conversationPrompt(conversationPresets[2], 'Fix login\n\nAccept expired sessions')).toBe('/implement Fix login\n\nAccept expired sessions');
    expect(conversationPrompt(conversationPresets[0], '#42')).toBe('');
  });
  it("automatically names a new branch and worktree outside the current worktree", () => {
    expect(newConversationWorktree("D:\\source\\repo\\", "a1b2c3d4")).toEqual({
      branch: "conversation/a1b2c3d4", path: "D:/source/repo-worktrees/a1b2c3d4",
    });
    expect(newConversationWorktree("/source/repo", "different").path).toBe("/source/repo-worktrees/different");
  });
  it("uses the requested skills as editable prompts without ticket placeholders", () => {
    expect(conversationPresets.map(preset => preset.prompt)).toEqual([
      "", "/triage ", "/implement ", "/diagnosing-bugs ",
      "/code-review Review the current uncommitted changes.",
    ]);
  });

  it("inherits the active worktree and model", () => {
    const worktreeModel = { instanceId: "codex", model: "custom" };
    const thread = { projectId: "current", worktreePath: "D:/feature", modelSelection: worktreeModel } as T3Thread;
    expect(conversationDefaults("d:\\feature\\", projects, thread)).toEqual({
      projectId: "current", worktreePath: "d:\\feature\\", modelSelection: worktreeModel,
    });
  });

  it("uses the active repository rather than an unrelated conversation or first project", () => {
    const thread = { projectId: "other", worktreePath: null, modelSelection: model } as T3Thread;
    expect(conversationDefaults("d:\\repo", projects, thread)).toEqual({
      projectId: "current", worktreePath: "d:\\repo", modelSelection: model,
    });
    expect(conversationDefaults("D:/unregistered", projects, thread).projectId).toBe("");
  });
});
