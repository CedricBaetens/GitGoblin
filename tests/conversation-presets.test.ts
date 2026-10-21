import { describe, expect, it } from "vitest";
import { conversationDefaults, conversationPresets, conversationPrompt, conversationTitle, matchingTicket, ticketReference, newConversationWorktree } from "../app/lib/conversation-presets";
import type { T3Project, T3Thread } from "../app/lib/types";

const model = { instanceId: "codex", model: "gpt-6" };
const projects: T3Project[] = [
  { id: "other", workspaceRoot: "D:/other", defaultModelSelection: model },
  { id: "current", workspaceRoot: "D:/repo", defaultModelSelection: model },
];

describe("conversation starters", () => {
  const ticket = { id: 42, title: 'Fix login after password reset', url: 'https://dev.azure.com/Acme/App/_workitems/edit/42' };

  it("names ticket conversations with the number and title before the action", () => {
    expect(conversationTitle(conversationPresets[1], ticket.url, ticket)).toBe('#42 · Fix login after password reset · Triage');
    expect(conversationTitle(conversationPresets[2], '#42', ticket)).toBe('#42 · Fix login after password reset · Implement');
    expect(conversationTitle(conversationPresets[1], '#42')).toBe('#42 · Triage');
    expect(conversationTitle(conversationPresets[1], 'Investigate login')).toBe('New conversation');
    expect(conversationTitle(conversationPresets[0], '#42', ticket)).toBe('New conversation');
  });

  it("resolves numbers and Azure ticket URLs without reusing another ticket's title", () => {
    expect(matchingTicket('42', [ticket])).toBe(ticket);
    expect(matchingTicket(' #42 ', [ticket])).toBe(ticket);
    expect(matchingTicket(`${ticket.url}?view=edit`, [ticket])).toBe(ticket);
    expect(matchingTicket('#43', [ticket])).toBeUndefined();
    expect(matchingTicket(ticket.url.replace('Acme', 'Other'), [ticket])).toBeUndefined();
    expect(ticketReference('https://example.com/_workitems/edit/42')).toBeUndefined();
    expect(ticketReference('Fix 42 login issues')).toBeUndefined();
    expect(ticketReference('https://acme.visualstudio.com/App/_workitems/edit/42')?.id).toBe(42);
  });

  it("carries a ticket reference or full description into ticket drafts without leaking it to other actions", () => {
    expect(conversationPrompt(conversationPresets[1], ' #42 ')).toMatch(/^\/triage #42\n\nUse the \$mattpocock-skills:triage skill\./);
    expect(conversationPrompt(conversationPresets[2], 'Fix login\n\nAccept expired sessions')).toMatch(/^\/implement Fix login\n\nAccept expired sessions\n\nUse the \$mattpocock-skills:implement skill\./);
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
