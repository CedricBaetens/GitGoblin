import type { T3Projection } from './types';

export interface ChatActivity { id: string; title: string; status: string }
export function chatActivities(projection: T3Projection | undefined, runId?: string | null, latestOnly = true): ChatActivity[] {
  if (!projection) return [];
  const result = new Map<string, ChatActivity>();
  const legacy = projection.activities || [];
  const turn = runId || (latestOnly ? [...legacy].reverse().find(item => item.turnId)?.turnId : undefined);
  for (const item of legacy) {
    if (turn && item.turnId !== turn) continue;
    if (item.tone !== 'tool' && item.tone !== 'error') continue;
    const id = item.payload?.toolCallId || item.id;
    const status = item.tone === 'error' || ['failed', 'error'].includes(item.payload?.status || '') ? 'failed'
      : item.kind === 'tool.completed' ? 'completed' : item.payload?.status || 'running';
    result.set(id, { id, title: item.payload?.title || item.summary, status });
  }
  const items = projection.turnItems || [];
  const currentRun = runId || (latestOnly ? [...items].reverse().find(item => item.runId)?.runId : undefined);
  for (const item of items) {
    if (currentRun && item.runId !== currentRun) continue;
    if (!['command_execution', 'file_change', 'file_search', 'web_search', 'dynamic_tool', 'subagent', 'reasoning'].includes(String(item.type))) continue;
    const title = item.type === 'reasoning' ? 'Thinking' : item.title || item.fileName || item.toolName || (typeof item.input === 'string' ? item.input : '') || String(item.type).replaceAll('_', ' ');
    result.set(String(item.id), { id: String(item.id), title: String(title), status: String(item.status || 'running') });
  }
  return latestOnly ? [...result.values()].slice(-6) : [...result.values()];
}
