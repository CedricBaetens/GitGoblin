import { expect, it } from 'vitest';
import { chatActivity, chatHistory, chatState, closeChatTab, moveChatTab, openChatTab, restoreChatTabs } from '../app/lib/chat-tabs';
import type { T3Projection, T3Thread } from '../app/lib/types';

it('prioritizes input requests and failures over working or completed state', () => {
  expect(chatState({ attention: true, running: true, completed: true })).toBe('waiting');
  expect(chatState({ status: 'awaiting_approval', running: true })).toBe('waiting');
  expect(chatState({ status: 'error', running: true, completed: true })).toBe('failed');
  expect(chatState({ running: true, completed: true })).toBe('working');
  expect(chatState({ completed: true })).toBe('done');
  expect(chatState({ status: 'completed' })).toBe('done');
  expect(chatState({ status: 'idle' })).toBe('ready');
});

it('restores valid unique tabs and repairs a missing selection', () => {
  expect(restoreChatTabs({ ids: ['a', null, 'b', 'a', ''], selected: 'missing' })).toEqual({ ids: ['a', 'b'], selected: 'a' });
  expect(restoreChatTabs(null)).toEqual({ ids: [], selected: '' });
  expect(restoreChatTabs({ ids: [], selected: 'a' })).toEqual({ ids: [], selected: '' });
});
it('focuses existing tabs without moving them, appends new tabs and restores their order', () => {
  let state = restoreChatTabs({ ids: ['repo-a', 'repo-b'], selected: 'repo-a' });
  state = openChatTab(state, 'repo-a');
  expect(state.ids).toEqual(['repo-a', 'repo-b']);
  state = openChatTab(state, 'repo-c');
  state = moveChatTab(state, 'repo-a', 'repo-c');
  expect(restoreChatTabs(JSON.parse(JSON.stringify(state)))).toEqual({ ids: ['repo-b', 'repo-c', 'repo-a'], selected: 'repo-c' });
  expect(moveChatTab(state, 'missing', 'repo-a')).toEqual(state);
});
it('closing chooses the neighboring tab without changing conversations', () => {
  const state = { ids: ['a', 'b', 'c'], selected: 'b' };
  expect(closeChatTab(state, 'a')).toEqual({ ids: ['b', 'c'], selected: 'b' });
  expect(closeChatTab(state, 'b')).toEqual({ ids: ['a', 'c'], selected: 'c' });
  expect(closeChatTab({ ids: ['a', 'b'], selected: 'b' }, 'b')).toEqual({ ids: ['a'], selected: 'a' });
  expect(closeChatTab({ ids: ['a'], selected: 'a' }, 'a')).toEqual({ ids: [], selected: '' });
  expect(state).toEqual({ ids: ['a', 'b', 'c'], selected: 'b' });
});
it('includes completed chats across repositories and separates archived from deleted history', () => {
  const threads = [
    { id: 'a', projectId: 'repo-a' }, { id: 'done', projectId: 'repo-b', settledOverride: 'settled' },
    { id: 'archived', archivedAt: 'today' }, { id: 'deleted', deletedAt: 'today' },
  ] as T3Thread[];
  expect(chatHistory(threads).map(thread => thread.id)).toEqual(['a', 'done']);
  expect(chatHistory(threads, true).map(thread => thread.id)).toEqual(['archived']);
});
it('tracks approvals, legacy questions and changing assistant responses independently', () => {
  const projection = { messages: [], runtimeRequests: [], turnItems: [] } as unknown as T3Projection;
  expect(chatActivity(projection)).toEqual({ attention: false, response: '' });
  projection.activities = [{ id: 'q', kind: 'user-input.requested', payload: { requestId: 'q', questions: [{ id: 'q' }] } }] as any;
  expect(chatActivity(projection).attention).toBe(true);
  projection.activities!.push({ id: 'resolved', kind: 'user-input.resolved', payload: { requestId: 'q' } } as any);
  expect(chatActivity(projection).attention).toBe(false);
  projection.runtimeRequests.push({ id: 'approve', status: 'pending', kind: 'approval' } as any);
  expect(chatActivity(projection).attention).toBe(true);
  projection.messages.push({ id: 'answer', role: 'assistant', text: 'Done', createdAt: 'now', streaming: true });
  const streaming = chatActivity(projection).response;
  projection.messages[0]!.streaming = false;
  expect(chatActivity(projection).response).not.toBe(streaming);
});
