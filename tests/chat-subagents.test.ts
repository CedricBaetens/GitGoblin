import { expect, it } from 'vitest';
import { chatSubagents } from '../app/lib/chat-subagents';
import { conversationTurns } from '../app/lib/conversation-turns';
import type { T3Projection } from '../app/lib/types';

it('merges subagent turn items with authoritative live records without duplicate cards', () => {
  const projection = { turnItems: [{ id: 'item', type: 'subagent', subagentId: 'agent', runId: 'run', prompt: 'Review queue handling', status: 'running' }],
    subagents: [{ id: 'agent', runId: 'run', title: 'Queue review', prompt: 'Review queue handling', status: 'completed', result: 'No issues', model: 'review-model' }] } as unknown as T3Projection;
  expect(chatSubagents(projection)).toMatchObject([{ id: 'agent', title: 'Queue review', status: 'completed', result: 'No issues', model: 'review-model' }]);
  projection.subagents = [];
  expect(chatSubagents(projection)).toMatchObject([{ id: 'agent', title: 'Review queue handling', status: 'running' }]);
});

it('keeps historical subagents with their own turn even when they complete during a later turn', () => {
  const projection = { messages: [
    { id: 'first', role: 'user', text: 'First task', createdAt: '2026-10-26T08:00:00Z', runId: 'first-run' },
    { id: 'next', role: 'user', text: 'Next task', createdAt: '2026-10-26T09:00:00Z', runId: 'next-run' },
  ], turnItems: [], subagents: [{ id: 'agent', runId: 'first-run', title: 'Review', status: 'completed', updatedAt: '2026-10-26T09:01:00Z' }] } as unknown as T3Projection;
  const turns = conversationTurns(projection);
  expect(turns[0]?.subagents).toHaveLength(1);
  expect(turns[1]?.subagents).toHaveLength(0);
});
