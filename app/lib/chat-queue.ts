import type { T3Projection } from './types';

export function queuedMessages(projection?: T3Projection) {
  return (projection?.runs || []).filter(run => run.status === 'queued')
    .sort((a, b) => (a.queuePosition ?? Infinity) - (b.queuePosition ?? Infinity))
    .map(run => ({ run, message: projection?.messages.find(message => message.id === run.userMessageId) }));
}
