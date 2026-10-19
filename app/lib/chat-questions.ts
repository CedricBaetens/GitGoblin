import type { T3Projection, T3Question, T3QuestionRequest } from './types';

export function pendingQuestions(projection: T3Projection | undefined): T3QuestionRequest[] {
  if (!projection) return [];
  const pending = new Map<string, T3QuestionRequest>();
  for (const activity of projection.activities || []) {
    const id = activity.payload?.requestId;
    if (!id) continue;
    if (activity.kind === 'user-input.requested' && activity.payload?.questions?.length)
      pending.set(id, { id, questions: activity.payload.questions });
    else if (activity.kind === 'user-input.resolved') pending.delete(id);
  }
  for (const request of projection.runtimeRequests) {
    if (request.kind !== 'user_input') continue;
    pending.delete(request.id);
    if (request.status !== 'pending') continue;
    const item = projection.turnItems.find(item => item.type === 'user_input_request' && item.requestId === request.id);
    if (Array.isArray(item?.questions) && item.questions.length)
      pending.set(request.id, { id: request.id, questions: item.questions as T3Question[],
        ...(request.responseCapability.type === 'not_resumable' ? { unavailableReason: request.responseCapability.reason || 'This question can no longer be answered.' } : {}) });
  }
  return [...pending.values()];
}

export function questionAnswers(questions: T3Question[], selections: Record<string, string[]>, custom: Record<string, string>) {
  const answers: Record<string, string | string[]> = {};
  for (const question of questions) {
    const text = question.allowCustomAnswer !== false ? custom[question.id]?.trim() : '';
    const selected = (selections[question.id] || []).filter(value => question.options.some(option => (option.value ?? option.label) === value));
    if (text) answers[question.id] = text;
    else if (selected.length) answers[question.id] = question.multiSelect ? selected : selected[0]!;
    else if (question.required !== false) return null;
  }
  return answers;
}
