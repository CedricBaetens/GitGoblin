import { expect, it } from 'vitest';
import { diffLanguage, highlightDiff, highlightCode } from '../app/lib/syntax';
import { parseDiff } from '../app/lib/diff';

it('detects each file language, including deleted files and paths with spaces', () => {
  expect(diffLanguage('+++ b/src/my file.cs\t')).toBe('csharp');
  expect(diffLanguage('--- a/old.ts\n+++ /dev/null')).toBe('typescript');
  expect(diffLanguage('', 'component.vue')).toBe('xml');
  expect(diffLanguage('+++ b/unknown.xyz')).toBeUndefined();
});

it('retains source text and independent multiline state on both sides', () => {
  const text = 'diff --git a/file.ts b/file.ts\n--- a/file.ts\n+++ b/file.ts\n@@ -1,3 +1,3 @@\n-/* comment\n+const value = 1;\n unchanged\n-*/\n+const html = "<img onerror=alert(1)>";\n';
  const tokens = highlightDiff(text);
  const lines = parseDiff(text).hunks[0]!.lines;
  for (const line of lines) {
    for (const value of Object.values(tokens[line.index]!))
      expect(value.map((token) => token.text).join('')).toBe(line.text.slice(1));
  }
  const context = lines.find((line) => line.kind === 'context')!;
  expect(tokens[context.index]!.old!.some((token) => token.classes.includes('hljs-comment'))).toBe(true);
  expect(tokens[context.index]!.next!.some((token) => token.classes.includes('hljs-comment'))).toBe(false);
  expect(tokens[lines.at(-1)!.index]!.next!.some((token) => token.classes.includes('hljs-string'))).toBe(true);
});

it('highlights history files separately and falls back for unknown or huge content', () => {
  const file = (path: string, code: string) => `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n@@ -0,0 +1 @@\n+${code}\n`;
  const text = file('a.cs', 'public class Example {}') + file('b.json', '{"ok": true}');
  const tokens = Object.values(highlightDiff(text)).flatMap((line) => line.next || []);
  expect(tokens.some((token) => token.text === 'public' && token.classes.includes('hljs-keyword'))).toBe(true);
  expect(tokens.some((token) => token.text === '"ok"' && token.classes.includes('hljs-attr'))).toBe(true);
  expect(highlightDiff(file('a.unknown', 'some text'))).toEqual({});
  expect(highlightDiff('x'.repeat(300_001), 'file.ts')).toEqual({});
});

it('uses the diff language and token classes for conflict editor code', () => {
  const text = 'const enabled = true;\n// comment\n';
  const lines = highlightCode(text, 'settings.ts');
  expect(lines.map(line => line.map(token => token.text).join('')).join('\n')).toBe(text);
  expect(lines[0]!.some(token => token.classes.includes('hljs-keyword'))).toBe(true);
  expect(highlightCode('unknown\n', 'file.unknown')).toEqual([[{ text: 'unknown', classes: '' }], [{ text: '', classes: '' }]]);
});
