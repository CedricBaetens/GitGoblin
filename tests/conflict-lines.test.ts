import { it, expect } from 'vitest';
import { conflictBlocks, acceptConflictLines } from '../app/lib/conflicts';
it('accepts selected individual lines in source order without losing line endings', () => {
  const text = 'before\n<<<<<<< HEAD\na\r\nb\r\n=======\r\nx\r\ny\r\n>>>>>>> other\nafter';
  expect(acceptConflictLines(text, conflictBlocks(text)[0]!, [1], [0])).toBe('before\nb\r\nx\r\nafter');
});
