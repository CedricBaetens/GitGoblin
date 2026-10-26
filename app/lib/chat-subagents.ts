import type { T3Projection, T3Subagent } from './types';

export interface ChatSubagent extends T3Subagent { title: string; itemId?: string }
export function chatSubagents(projection?: T3Projection): ChatSubagent[] {
  const agents = new Map<string, ChatSubagent>();
  for (const item of projection?.turnItems || []) {
    if (item.type !== 'subagent') continue;
    const id = String(item.subagentId || item.id);
    agents.set(id, {
      id, itemId: String(item.id), runId: typeof item.runId === 'string' ? item.runId : null,
      title: String(item.title || item.prompt || 'Subagent'),
      prompt: typeof item.prompt === 'string' ? item.prompt : undefined,
      status: String(item.status || 'pending'),
      progress: typeof item.progress === 'string' ? item.progress : undefined,
      result: typeof item.result === 'string' ? item.result : null,
      startedAt: typeof item.startedAt === 'string' ? item.startedAt : null,
      updatedAt: typeof item.updatedAt === 'string' ? item.updatedAt : undefined,
    });
  }
  for (const agent of projection?.subagents || []) {
    const item = agents.get(agent.id);
    agents.set(agent.id, { ...item, ...agent, runId: agent.runId || item?.runId,
      title: agent.title || agent.prompt || item?.title || 'Subagent',
      model: agent.modelSelection?.model || agent.model });
  }
  return [...agents.values()];
}
