import { expect, it } from 'vitest';
import { pendingQuestions, questionAnswers } from '../app/lib/chat-questions';
import type { T3Projection, T3Question } from '../app/lib/types';
const question: T3Question = { id: 'scope', header: 'Scope', question: 'What should change?', options: [
  { label: 'Frontend', value: ' web ' }, { label: 'Backend', value: 'server' },
], allowCustomAnswer: true };
const projection = (extra: Partial<T3Projection>): T3Projection => ({ thread: {} as any, messages: [], runtimeRequests: [], turnItems: [], ...extra });

it('restores legacy pending questions and removes questions resolved by another client', () => {
  const activities = [
    { id: 'one', kind: 'user-input.requested', payload: { requestId: 'first', questions: [question] } },
    { id: 'two', kind: 'user-input.requested', payload: { requestId: 'second', questions: [question] } },
    { id: 'three', kind: 'user-input.resolved', payload: { requestId: 'first' } },
  ] as any;
  expect(pendingQuestions(projection({ activities }))).toEqual([{ id: 'second', questions: [question] }]);
});
it('matches modern questions with pending runtime requests and respects non-resumable requests', () => {
  const p = projection({ runtimeRequests: [{ id: 'input', kind: 'user_input', status: 'pending', responseCapability: { type: 'not_resumable', reason: 'Session ended' } }],
    turnItems: [{ id: 'item', type: 'user_input_request', requestId: 'input', questions: [question] }] });
  expect(pendingQuestions(p)).toEqual([{ id: 'input', questions: [question], unavailableReason: 'Session ended' }]);
  p.runtimeRequests[0]!.status = 'resolved';
  expect(pendingQuestions(p)).toEqual([]);
});
it('requires answers, preserves provider option values, and serializes single, multiple and custom choices', () => {
  expect(questionAnswers([question], {}, {})).toBeNull();
  expect(questionAnswers([question], { scope: [' web '] }, {})).toEqual({ scope: ' web ' });
  expect(questionAnswers([{ ...question, multiSelect: true }], { scope: [' web ', 'server', 'invalid'] }, {})).toEqual({ scope: [' web ', 'server'] });
  expect(questionAnswers([question], {}, { scope: '  Something else  ' })).toEqual({ scope: 'Something else' });
  expect(questionAnswers([{ ...question, allowCustomAnswer: false }], {}, { scope: 'Ignore restriction' })).toBeNull();
  expect(questionAnswers([{ ...question, required: false }], {}, {})).toEqual({});
});
