import { expect, it } from 'vitest';
import { inlineChanges } from '../app/lib/inline-changes';
import { highlightDiff } from '../app/lib/syntax';
import { parseDiff } from '../app/lib/diff';

const changed = (text: string, ranges: ReturnType<typeof inlineChanges>['old']) => ranges.map(range => text.slice(range.start, range.end));
it('isolates changed words, individual characters, insertions and deletions', () => {
  const before = '/// GET one KPI as CSV over a date range.';
  const after = '/// GET one KPI as Excel over a date range.';
  const result = inlineChanges(before, after);
  expect(changed(before, result.old)).toEqual(['CSV']);
  expect(changed(after, result.next)).toEqual(['Excel']);
  expect(inlineChanges('count = 1;', 'count = 2;')).toEqual({ old: [{ start: 8, end: 9 }], next: [{ start: 8, end: 9 }] });
  expect(inlineChanges('abc', 'abXc')).toEqual({ old: [], next: [{ start: 2, end: 3 }] });
  expect(inlineChanges('abXc', 'abc')).toEqual({ old: [{ start: 2, end: 3 }], next: [] });
  expect(inlineChanges('same', 'same')).toEqual({ old: [], next: [] });
});

it('keeps unchanged islands and whole Unicode characters', () => {
  const before = 'old = 1; // old', after = 'new = 1; // new';
  const result = inlineChanges(before, after);
  expect(changed(before, result.old)).toEqual(['old', 'old']);
  expect(changed(after, result.next)).toEqual(['new', 'new']);
  const emoji = inlineChanges('A😀B', 'A😎B');
  expect(changed('A😀B', emoji.old)).toEqual(['😀']);
  expect(changed('A😎B', emoji.next)).toEqual(['😎']);
});

it('bounds comparison for long lines while retaining shared ends', () => {
  const before = 'start' + 'a'.repeat(1000) + 'end';
  const after = 'start' + 'b'.repeat(1000) + 'end';
  expect(changed(before, inlineChanges(before, after).old)).toEqual(['a'.repeat(1000)]);
});

it.each(['file.cs', 'file.unknown'])('marks paired replacements while preserving text and syntax in %s', path => {
  const text = `--- a/${path}\n+++ b/${path}\n@@ -1,2 +1,2 @@\n-// Export CSV\n+// Export Excel\n unchanged\n`;
  const result = highlightDiff(text);
  for (const line of parseDiff(text).hunks[0]!.lines.filter(line => line.kind !== 'context')) {
    const tokens = result[line.index]![line.kind === 'delete' ? 'old' : 'next']!;
    expect(tokens.map(token => token.text).join('')).toBe(line.text.slice(1));
    expect(tokens.filter(token => token.classes.includes('diff-inline-change')).map(token => token.text).join('')).toBe(line.kind === 'delete' ? 'CSV' : 'Excel');
    if (path.endsWith('.cs')) expect(tokens.every(token => token.classes.includes('hljs-comment'))).toBe(true);
  }
});

it('does not compare standalone additions and deletions separated by context', () => {
  const text = '--- a/file.txt\n+++ b/file.txt\n@@ -1,2 +1,2 @@\n-removed\n unchanged\n+added\n';
  expect(highlightDiff(text)).toEqual({});
});
