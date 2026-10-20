export interface ConflictBlock { start: number; end: number; ours: string; theirs: string }
export const hasConflictMarkers = (text: string) => /^(<<<<<<<|=======|>>>>>>>|\|\|\|\|\|\|\|)/m.test(text);
export function conflictBlocks(text: string): ConflictBlock[] {
  const pattern = /^<<<<<<<[^\n]*\r?\n([\s\S]*?)^=======[^\n]*\r?\n([\s\S]*?)^>>>>>>>[^\n]*(?:\r?\n|$)/gm;
  return [...text.matchAll(pattern)].map(match => ({ start: match.index!, end: match.index! + match[0].length, ours: match[1]!.split(/^\|\|\|\|\|\|\|[^\n]*\r?\n/m)[0]!, theirs: match[2]! }));
}
export function acceptConflict(text: string, block: ConflictBlock, side: 'ours' | 'theirs' | 'both') {
  return text.slice(0, block.start) + (side === 'both' ? block.ours + block.theirs : block[side]) + text.slice(block.end);
}

export function conflictLines(text: string): string[] {
  return text.match(/[^\n]*\n|[^\n]+$/g) || [];
}
export function acceptConflictLines(text: string, block: ConflictBlock, ours: number[], theirs: number[]) {
  const selected = (side: string, indexes: number[]) => conflictLines(side).filter((_, index) => indexes.includes(index)).join('');
  return text.slice(0, block.start) + selected(block.ours, ours) + selected(block.theirs, theirs) + text.slice(block.end);
}

export function conflictSidePreview(text: string, side: 'ours' | 'theirs', activeIndex: number) {
  let content = '', cursor = 0, start = 0, end = 0;
  conflictBlocks(text).forEach((block, index) => {
    content += text.slice(cursor, block.start);
    if (index === activeIndex) start = content.length;
    content += block[side] || '\n';
    if (index === activeIndex) end = content.length;
    cursor = block.end;
  });
  content += text.slice(cursor);
  const firstLine = content.slice(0, start).split('\n').length - 1;
  return { text: content, start, end, range: { start: firstLine, end: firstLine + Math.max(1, conflictLines(content.slice(start, end)).length) - 1 } };
}
