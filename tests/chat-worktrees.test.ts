import { expect, it } from 'vitest';
import { chatWorktreeOptions } from '../app/lib/chat-worktrees';

const trees = [
  { path: 'D:/source/GitGoblin', branch: 'master' },
  { path: 'D:/source/GitGoblin-worktrees/123', branch: 'conversation/123' },
];

it('matches the current folder despite Windows case, separators, and trailing slash differences', () => {
  const options = chatWorktreeOptions(trees, 'd:\\source\\GitGoblin\\');
  expect(options).toHaveLength(2);
  expect(options[0]).toEqual({ path: 'd:\\source\\GitGoblin\\', label: 'Main checkout · master' });
  expect(options[1]?.label).toBe('Separate worktree · conversation/123 · 123');
});

it('keeps an unknown current folder selected without guessing its checkout type', () => {
  expect(chatWorktreeOptions(trees, 'D:/other', 'feature')[0]).toEqual({ path: 'D:/other', label: 'Current folder · feature' });
  expect(chatWorktreeOptions([], 'D:/other')[0]?.label).toBe('Current folder');
});
