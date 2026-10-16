export const diffRowHeight = 23;

export function diffWindow(count: number, offset: number, scroll: number, height: number) {
  const start = Math.min(count, Math.max(0, Math.floor((scroll - offset) / diffRowHeight) - 15));
  const end = Math.max(start, Math.min(count, Math.ceil((scroll + height - offset) / diffRowHeight) + 15));
  return { start, end, before: start * diffRowHeight, after: (count - end) * diffRowHeight };
}

export interface DiffChange { offset: number; height: number; kind: string; line: string }
