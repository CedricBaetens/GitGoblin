import { expect, it } from 'vitest';
import { chatActivities } from '../app/lib/chat-activity';
import type { T3Projection } from '../app/lib/types';

it('collapses legacy tool lifecycle events and hides previous turns', () => {
  const activity = (id: string, kind: string, turnId = 'current') => ({ id, kind, turnId, tone: 'tool', summary: 'Run tests', createdAt: id, payload: { toolCallId: 'tool' } });
  const projection = { activities: [activity('1', 'tool.started', 'old'), activity('2', 'tool.started'), activity('3', 'tool.completed')], turnItems: [] } as unknown as T3Projection;
  expect(chatActivities(projection, 'current')).toEqual([{ id: 'tool', title: 'Run tests', status: 'completed' }]);
  expect(chatActivities(projection, 'next')).toEqual([]);
  expect(chatActivities(projection)).toHaveLength(1);
});

it('shows modern tool progress without rendering message duplicates or reasoning contents', () => {
  const projection = { turnItems: [
    { id: 'old', type: 'command_execution', runId: 'old', input: 'old command', status: 'completed' },
    { id: 'thought', type: 'reasoning', runId: 'run', text: 'reasoning details', status: 'running' },
    { id: 'tool', type: 'dynamic_tool', runId: 'run', toolName: 'Read file', input: {}, status: 'completed' },
    { id: 'message', type: 'assistant_message', runId: 'run', text: 'reply', status: 'running' },
  ] } as unknown as T3Projection;
  expect(chatActivities(projection, 'run')).toEqual([
    { id: 'thought', title: 'Thinking', status: 'running' },
    { id: 'tool', title: 'Read file', status: 'completed' },
  ]);
});
