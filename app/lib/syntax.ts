import { common, createLowlight } from 'lowlight';
import { parseDiffFiles, splitDiffLines } from './diff';
import { inlineChanges, type ChangeRange } from './inline-changes';

const highlighter = createLowlight(common);
export interface SyntaxToken { text: string; classes: string }
export type DiffSyntax = Record<number, { old?: SyntaxToken[]; next?: SyntaxToken[] }>;

const languages: Record<string, string> = {
  js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
  ts: 'typescript', tsx: 'typescript', vue: 'xml', html: 'xml', htm: 'xml', xml: 'xml', svg: 'xml', csproj: 'xml',
  cs: 'csharp', css: 'css', scss: 'scss', less: 'less', json: 'json', jsonc: 'json',
  rs: 'rust', py: 'python', go: 'go', java: 'java', kt: 'kotlin', rb: 'ruby', php: 'php',
  c: 'c', h: 'c', cpp: 'cpp', hpp: 'cpp', sql: 'sql', sh: 'bash', bash: 'bash',
  yml: 'yaml', yaml: 'yaml', toml: 'ini', ini: 'ini', md: 'markdown', markdown: 'markdown',
};
export function diffLanguage(header: string, fallback = '') {
  // Git appends a tab after paths containing spaces; deleted files use the old path.
  let path = /^\+\+\+ (.+)$/m.exec(header)?.[1]?.split('\t')[0] || fallback;
  if (path === '/dev/null') path = /^--- (.+)$/m.exec(header)?.[1]?.split('\t')[0] || fallback;
  const name = path?.replace(/"$/, '').split('/').at(-1)?.toLowerCase() || '';
  const language = name === 'dockerfile' ? 'dockerfile' : name === 'makefile' ? 'makefile' : languages[name.split('.').at(-1)!];
  return language && highlighter.registered(language) ? language : undefined;
}

function codeLines(code: string, language: string): SyntaxToken[][] {
  const lines: SyntaxToken[][] = [[]];
  const tree = highlighter.highlight(language, code);
  function visit(node: typeof tree | (typeof tree.children)[number], classes = '') {
    if (node.type === 'text') {
      node.value.split('\n').forEach((text, index) => {
        if (index) lines.push([]);
        if (text) lines.at(-1)!.push({ text, classes });
      });
    } else if ('children' in node) {
      const own = node.type === 'element' ? (node.properties.className || []) : [];
      const next = [classes, ...(Array.isArray(own) ? own : [own])].filter(Boolean).join(' ');
      for (const child of node.children) visit(child, next);
    }
  }
  visit(tree);
  return lines;
}

function markChanges(tokens: SyntaxToken[], ranges: ChangeRange[]): SyntaxToken[] {
  const result: SyntaxToken[] = [];
  let offset = 0, rangeIndex = 0;
  for (const token of tokens) {
    const end = offset + token.text.length;
    let start = offset;
    while (start < end) {
      while (ranges[rangeIndex] && ranges[rangeIndex]!.end <= start) rangeIndex++;
      const range = ranges[rangeIndex];
      const changed = range && range.start <= start;
      const boundary = Math.min(end, range ? changed ? range.end : range.start : end);
      result.push({ text: token.text.slice(start - offset, boundary - offset), classes: changed ? `${token.classes} diff-inline-change`.trim() : token.classes });
      start = boundary;
    }
    offset = end;
  }
  return result;
}

export function highlightDiff(text: string, path = ''): DiffSyntax {
  const result: DiffSyntax = {};
  // Bound token/DOM growth for generated or huge files; plain diffs remain available.
  if (text.length > 300_000) return result;
  for (const file of parseDiffFiles(text)) {
    const language = diffLanguage(file.header, path);
    for (const hunk of file.hunks) {
      if (language) for (const side of ['old', 'next'] as const) {
        const lines = hunk.lines.filter((line) => line.kind !== 'meta' && line.kind !== (side === 'old' ? 'add' : 'delete'));
        if (!lines.length) continue;
        const tokens = codeLines(lines.map((line) => line.text.slice(1)).join('\n'), language);
        lines.forEach((line, index) => { (result[line.index] ||= {})[side] = tokens[index] || []; });
      }
      for (const row of splitDiffLines(hunk.lines)) {
        if (row.left?.kind !== 'delete' || row.right?.kind !== 'add') continue;
        const changes = inlineChanges(row.left.text.slice(1), row.right.text.slice(1));
        for (const [line, side] of [[row.left, 'old'], [row.right, 'next']] as const) {
          const entry = result[line.index] ||= {};
          entry[side] = markChanges(entry[side] || [{ text: line.text.slice(1), classes: '' }], changes[side]);
        }
      }
    }
  }
  return result;
}
