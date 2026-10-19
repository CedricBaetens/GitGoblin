export const diffRowHeight = 23;

export function diffWindow(count: number, offset: number, scroll: number, height: number, rowHeight = diffRowHeight) {
  const start = Math.min(count, Math.max(0, Math.floor((scroll - offset) / rowHeight) - 15));
  const end = Math.max(start, Math.min(count, Math.ceil((scroll + height - offset) / rowHeight) + 15));
  return { start, end, before: start * rowHeight, after: (count - end) * rowHeight };
}

export interface DiffChange { offset: number; height: number; kind: string; line: string }
