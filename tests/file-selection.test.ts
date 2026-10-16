import { expect, it } from 'vitest';
import { selectFiles } from '../app/lib/file-selection';
const rows = ['a', 'folder/b', 'folder/c', 'd'];
const modifiers = { shiftKey: false, ctrlKey: false, metaKey: false };
it('supports plain selection and Ctrl toggling without changing the input', () => {
  const current = new Set(['a']);
  const added = selectFiles(rows, current, 'a', 'd', { ...modifiers, ctrlKey: true });
  expect([...added.paths]).toEqual(['a', 'd']);
  expect([...current]).toEqual(['a']);
  expect([...selectFiles(rows, added.paths, 'd', 'a', { ...modifiers, ctrlKey: true }).paths]).toEqual(['d']);
  expect([...selectFiles(rows, added.paths, 'd', 'folder/b', modifiers).paths]).toEqual(['folder/b']);
});
it('selects ranges in visible order and supports Ctrl+Shift extending the selection', () => {
  const range = selectFiles(rows, new Set(['d']), 'folder/c', 'a', { ...modifiers, shiftKey: true });
  expect([...range.paths]).toEqual(['a', 'folder/b', 'folder/c']);
  expect(range.anchor).toBe('folder/c');
  expect([...selectFiles(rows, new Set(['d']), 'a', 'folder/b', { ...modifiers, shiftKey: true, ctrlKey: true }).paths]).toEqual(['d', 'a', 'folder/b']);
  expect([...selectFiles(rows, new Set(), 'hidden', 'd', { ...modifiers, shiftKey: true }).paths]).toEqual(['d']);
});
