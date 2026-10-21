import type { T3Projection, T3Thread } from './types';
import { pendingQuestions } from './chat-questions';

export interface ChatTabsState { ids: string[]; selected: string }
export function chatState(value: { attention?: boolean; running?: boolean; completed?: boolean; status?: string }) {
  if (value.attention || ['waiting', 'waiting-for-input', 'waiting_for_input', 'awaiting-input', 'awaiting_approval'].includes(value.status || '')) return 'waiting';
  if (['error', 'failed'].includes(value.status || '')) return 'failed';
  if (value.running) return 'working';
  if (value.completed || ['completed', 'done'].includes(value.status || '')) return 'done';
  return 'ready';
}
export function restoreChatTabs(value: unknown): ChatTabsState {
  const saved = value as Partial<ChatTabsState> | null;
  const ids = Array.isArray(saved?.ids) ? [...new Set(saved.ids.filter((id): id is string => typeof id === 'string' && !!id))] : [];
  return { ids, selected: typeof saved?.selected === 'string' && ids.includes(saved.selected) ? saved.selected : ids[0] || '' };
}
export function openChatTab(state: ChatTabsState, id: string): ChatTabsState {
  return { ids: state.ids.includes(id) ? state.ids : [...state.ids, id], selected: id };
}
export function closeChatTab(state: ChatTabsState, id: string): ChatTabsState {
  const index = state.ids.indexOf(id), ids = state.ids.filter(value => value !== id);
  return { ids, selected: state.selected === id ? ids[Math.min(index, ids.length - 1)] || '' : state.selected };
}
export function moveChatTab(state: ChatTabsState, id: string, target: string): ChatTabsState {
  if (id === target || !state.ids.includes(id) || !state.ids.includes(target)) return state;
  const ids = state.ids.filter(value => value !== id);
  ids.splice(state.ids.indexOf(target), 0, id);
  return { ...state, ids };
}
export function chatHistory(threads: T3Thread[], archived = false): T3Thread[] {
  return threads.filter(thread => !thread.deletedAt && (!!thread.archivedAt === archived))
    .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || '') || a.id.localeCompare(b.id));
}
export function chatActivity(projection: T3Projection) {
  const last = projection.messages.filter(message => message.role === 'assistant').at(-1);
  return {
    attention: projection.runtimeRequests.some(request => request.status === 'pending') || pendingQuestions(projection).length > 0,
    response: last ? `${last.id}:${last.updatedAt || last.createdAt}:${last.text.length}:${last.streaming}` : '',
  };
}
