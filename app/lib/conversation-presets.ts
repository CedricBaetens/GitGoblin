import type { T3Project, T3Thread } from "./types";
import { repositoryThreadKey } from "./threads";

export const conversationPresets = [
  { label: "Blank", description: "Start with your own instruction.", prompt: "" },
  { label: "Triage ticket", description: "Investigate a ticket and clarify the scope.", prompt: "/triage ", ticket: true },
  { label: "Implement ticket", description: "Build a ticket with tests and code review.", prompt: "/implement ", ticket: true },
  { label: "Debug", description: "Investigate a bug and find its cause.", prompt: "/diagnosing-bugs " },
  { label: "Review changes", description: "Review the current uncommitted changes.", prompt: "/code-review Review the current uncommitted changes." },
] as const;

export function conversationPrompt(preset: (typeof conversationPresets)[number], ticket: string) {
  return 'ticket' in preset ? preset.prompt + ticket.trim() : preset.prompt;
}

export function newConversationWorktree(repo: string, suffix: string) {
  const root = repo.replaceAll('\\', '/').replace(/\/+$/, '');
  return { branch: `conversation/${suffix}`, path: `${root}-worktrees/${suffix}` };
}

export function conversationDefaults(repo: string, projects: T3Project[], thread?: T3Thread) {
  const currentProject = projects.find(project => project.id === thread?.projectId);
  const currentPath = thread?.worktreePath || currentProject?.workspaceRoot;
  const current = currentPath && repositoryThreadKey(currentPath) === repositoryThreadKey(repo) ? thread : undefined;
  const project = current ? currentProject : projects.find(project => repositoryThreadKey(project.workspaceRoot) === repositoryThreadKey(repo));
  return {
    projectId: project?.id || "",
    worktreePath: repo,
    modelSelection: current?.modelSelection || project?.defaultModelSelection || undefined,
  };
}
