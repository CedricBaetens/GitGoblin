import type { T3Project, T3Thread } from "./types";
import { repositoryThreadKey } from "./threads";

export interface ConversationTicket { id: number; title: string; url: string }

export function ticketReference(reference: string) {
  const value = reference.trim();
  const number = value.match(/^#?(\d+)$/)?.[1];
  if (number) return { id: Number(number) };
  try {
    const url = new URL(value);
    const id = url.pathname.match(/\/_workitems\/edit\/(\d+)\/?$/i)?.[1];
    if (url.protocol === 'https:' && (url.hostname === 'dev.azure.com' || url.hostname.endsWith('.visualstudio.com')) && id) {
      return { id: Number(id), url };
    }
  } catch { /* A description is also a valid ticket instruction. */ }
  return undefined;
}

export function matchingTicket(reference: string, tickets: ConversationTicket[]) {
  const parsed = ticketReference(reference);
  return parsed && tickets.find(ticket => {
    if (ticket.id !== parsed.id) return false;
    if (!parsed.url) return true;
    const url = new URL(ticket.url);
    return url.origin === parsed.url.origin && url.pathname.replace(/\/$/, '') === parsed.url.pathname.replace(/\/$/, '');
  });
}

export function conversationTitle(preset: (typeof conversationPresets)[number], reference: string, ticket?: ConversationTicket) {
  if (!('ticket' in preset)) return 'New conversation';
  const id = ticketReference(reference)?.id;
  if (!id) return 'New conversation';
  const title = ticket?.title.trim().replace(/\s+/g, ' ');
  const action = preset.prompt === '/triage ' ? 'Triage' : 'Implement';
  return `#${id}${title ? ` · ${title}` : ''} · ${action}`;
}

export const conversationPresets = [
  { label: "Blank", description: "Start with your own instruction.", prompt: "" },
  { label: "Triage ticket", description: "Investigate a ticket and clarify the scope.", prompt: "/triage ", ticket: true, skill: "mattpocock-skills:triage" },
  { label: "Implement ticket", description: "Build a ticket with tests and code review.", prompt: "/implement ", ticket: true, skill: "mattpocock-skills:implement" },
  { label: "Debug", description: "Investigate a bug and find its cause.", prompt: "/diagnosing-bugs " },
  { label: "Review changes", description: "Review the current uncommitted changes.", prompt: "/code-review Review the current uncommitted changes." },
] as const;

export function conversationPrompt(preset: (typeof conversationPresets)[number], ticket: string) {
  const prompt = 'ticket' in preset ? preset.prompt + ticket.trim() : preset.prompt;
  return 'skill' in preset
    ? `${prompt}\n\nUse the $${preset.skill} skill. Read its SKILL.md and follow its workflow for this ticket. State which skill you loaded before starting. If the skill is unavailable, stop and report that instead of proceeding without it.`
    : prompt;
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
