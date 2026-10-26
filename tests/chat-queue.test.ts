import { expect, it } from 'vitest';
import { queuedMessages } from '../app/lib/chat-queue';
import type { T3Projection } from '../app/lib/types';

it('shows server queue order and held state, and removes started or cancelled runs', () => {
  const projection = { messages: [{ id: 'a', text: 'First' }, { id: 'b', text: 'Second' }], runs: [
    { id: 'second', userMessageId: 'b', status: 'queued', queuePosition: 2 },
    { id: 'first', userMessageId: 'a', status: 'queued', queuePosition: 1, queueHeld: true },
    { id: 'cancelled', userMessageId: 'c', status: 'cancelled' },
  ] } as T3Projection;
  expect(queuedMessages(projection).map(row => row.message?.text)).toEqual(['First', 'Second']);
  expect(queuedMessages(projection)[0]?.run.queueHeld).toBe(true);
  projection.runs![1]!.status = 'running';
  expect(queuedMessages(projection).map(row => row.run.id)).toEqual(['second']);
});
