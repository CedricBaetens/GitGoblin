import { expect, it } from 'vitest';
import { conversationTurns } from '../app/lib/conversation-turns';
import type { T3Projection } from '../app/lib/types';

const time = (seconds: number) => new Date(Date.UTC(2026, 9, 19, 8, 0, seconds)).toISOString();
const message = (id: string, role: string, seconds: number, runId?: string) => ({ id, role, text: id, createdAt: time(seconds), streaming: false, runId });

it('groups legacy work before each final answer and retains every tool call', () => {
  const projection = { messages: [message('user', 'user', 0), message('progress', 'assistant', 1), message('answer', 'assistant', 20), message('next', 'user', 30), message('second answer', 'assistant', 40)],
    activities: Array.from({ length: 8 }, (_, i) => ({ id: String(i), turnId: 'first', kind: 'tool.completed', tone: 'tool', summary: 'Ran command', createdAt: time(i + 2) })), turnItems: [] } as unknown as T3Projection;
  const turns = conversationTurns(projection);
  expect(turns[0]?.summary).toBe('Worked for 20s');
  expect(turns[0]?.work.map(message => message.id)).toEqual(['progress']);
  expect(turns[0]?.final?.id).toBe('answer');
  expect(turns[0]?.activities).toHaveLength(8);
  expect(turns[1]?.activities).toEqual([]);
});

it('associates modern tools by run even without timestamps and does not expose reasoning text', () => {
  const projection = { messages: [message('user', 'user', 0), message('progress', 'assistant', 1, 'run')],
    turnItems: [{ id: 'tool', runId: 'run', type: 'command_execution', title: 'Run tests', status: 'running' }, { id: 'thought', runId: 'run', type: 'reasoning', text: 'private reasoning', status: 'running' }] } as unknown as T3Projection;
  const [turn] = conversationTurns(projection, 'run');
  expect(turn?.summary).toBe('Working…');
  expect(turn?.activities.map(item => item.title)).toEqual(['Run tests', 'Thinking']);
  expect(turn?.final?.id).toBe('progress');
});

it('keeps queued and cancelled messages out of the conversation until their run starts', () => {
  const projection = { messages: [message('active', 'user', 0), message('queued', 'user', 1), message('cancelled', 'user', 2)],
    runs: [{ id: 'pending', userMessageId: 'queued', status: 'queued' }, { id: 'removed', userMessageId: 'cancelled', status: 'cancelled' }], turnItems: [] } as unknown as T3Projection;
  expect(conversationTurns(projection, 'active').map(turn => turn.id)).toEqual(['active']);
  projection.runs![0]!.status = 'running';
  expect(conversationTurns(projection, 'pending').map(turn => turn.id)).toEqual(['active', 'queued']);
});
