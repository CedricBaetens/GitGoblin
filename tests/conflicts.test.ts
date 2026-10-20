import { describe, it, expect } from 'vitest';
import { conflictBlocks, acceptConflict, hasConflictMarkers, conflictSidePreview } from '../app/lib/conflicts';
describe('conflict resolution', () => {
  it('resolves one diff3 block while preserving context and subsequent conflicts', () => {
    const block = '<<<<<<< HEAD\ncurrent\n||||||| base\nancestor\n=======\nincoming\n>>>>>>> commit\n';
    const text = 'before\n' + block + 'middle\n' + block + 'after';
    const blocks = conflictBlocks(text);
    expect(blocks).toHaveLength(2);
    const result = acceptConflict(text, blocks[0]!, 'both');
    expect(result).toBe('before\ncurrent\nincoming\nmiddle\n' + block + 'after');
    expect(hasConflictMarkers(result)).toBe(true);
    expect(hasConflictMarkers(acceptConflict(result, conflictBlocks(result)[0]!, 'theirs'))).toBe(false);
  });
  it('supports CRLF and an absent final newline', () => {
    const text = '<<<<<<< HEAD\r\na\r\n=======\r\nb\r\n>>>>>>> other';
    expect(acceptConflict(text, conflictBlocks(text)[0]!, 'ours')).toBe('a\r\n');
  });
});

it('shows shared context and maps the selected conflict to source lines', () => {
  const text = 'before\n<<<<<<< HEAD\na\n=======\nb\n>>>>>>> branch\nbetween\n<<<<<<< HEAD\n=======\nx\n>>>>>>> branch\nafter';
  const ours = conflictSidePreview(text, 'ours', 1);
  expect(ours.text).toBe('before\na\nbetween\n\nafter');
  expect(ours.range).toEqual({ start: 3, end: 3 });
  const theirs = conflictSidePreview(text, 'theirs', 0);
  expect(theirs.text).toBe('before\nb\nbetween\nx\nafter');
  expect(theirs.text.slice(theirs.start, theirs.end)).toBe('b\n');
});
