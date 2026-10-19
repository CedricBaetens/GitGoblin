import type { T3Message, T3Projection } from './types';
import { chatActivities } from './chat-activity';

export function conversationTurns(projection: T3Projection | undefined, activeRunId?: string | null) {
  const messages = [...(projection?.messages || [])].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const groups: T3Message[][] = [];
  for (const message of messages) {
    if (!groups.length || message.role === 'user') groups.push([]);
    groups.at(-1)!.push(message);
  }
  return groups.map((group, index) => {
    const start = group[0]!.createdAt;
    const end = groups[index + 1]?.[0]?.createdAt;
    const runIds = new Set(group.flatMap(message => message.runId || message.turnId ? [message.runId || message.turnId] : []));
    if (index === groups.length - 1 && activeRunId) runIds.add(activeRunId);
    const belongs = (run: unknown, date: unknown) => run && runIds.has(String(run)) || typeof date === 'string' && date >= start && (!end || date < end);
    const activities = chatActivities(projection && {
      ...projection,
      activities: projection.activities?.filter(item => belongs(item.turnId, item.createdAt)),
      turnItems: projection.turnItems?.filter(item => belongs(item.runId, item.startedAt || item.createdAt)),
    }, null, false);
    const assistants = group.filter(message => message.role === 'assistant');
    const running = index === groups.length - 1 && (!!activeRunId || assistants.some(message => message.streaming));
    const final = assistants.at(-1);
    const work = group.filter(message => message.role !== 'user' && message !== final);
    const lastTime = final?.updatedAt || final?.createdAt;
    const seconds = lastTime ? Math.max(0, Math.round((Date.parse(lastTime) - Date.parse(start)) / 1000)) : NaN;
    const duration = Number.isFinite(seconds) ? seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s` : '';
    return { id: group[0]!.id, users: group.filter(message => message.role === 'user'), work, final, activities,
      summary: running ? 'Working…' : duration ? `Worked for ${duration}` : 'Work details' };
  });
}
