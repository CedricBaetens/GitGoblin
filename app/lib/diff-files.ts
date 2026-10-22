import type { FileStatus } from './types';

// Git quotes unusual paths using C escapes and UTF-8 octal bytes.
function gitPath(value: string) {
  if (!value.startsWith('"')) return value;
  const bytes: number[] = [];
  const inner = value.slice(1, -1);
  for (let i = 0; i < inner.length; i++) {
    if (inner[i] === '\\') {
      const octal = /^[0-7]{1,3}/.exec(inner.slice(i + 1));
      if (octal) { bytes.push(parseInt(octal[0], 8)); i += octal[0].length; continue; }
      const char = inner[++i] || '';
      bytes.push(...new TextEncoder().encode(({ n: '\n', t: '\t', r: '\r' } as Record<string, string>)[char] ?? char));
    } else bytes.push(...new TextEncoder().encode(inner[i]));
  }
  return new TextDecoder().decode(new Uint8Array(bytes));
}

export function diffFileStatus(header: string): FileStatus | undefined {
  if (!header.startsWith('diff --git ')) return;
  const destination = /^\+\+\+ (.+)$/m.exec(header)?.[1];
  const source = /^--- (.+)$/m.exec(header)?.[1];
  const renamed = /^rename to (.+)$/m.exec(header)?.[1];
  const copied = /^copy to (.+)$/m.exec(header)?.[1];
  const fallback = /^diff --git (?:"(?:[^"\\]|\\.)*"|.*?) ("(?:[^"\\]|\\.)*"|b\/.*)$/m.exec(header)?.[1];
  const raw = destination && destination !== '/dev/null' ? destination : source && source !== '/dev/null' ? source : fallback;
  const path = renamed ? gitPath(renamed) : copied ? gitPath(copied) : raw ? gitPath(raw).replace(/^[ab]\//, '') : '';
  if (!path) return;
  const status = /^new file mode /m.test(header) ? 'A' : /^deleted file mode /m.test(header) ? 'D' : renamed ? 'R' : copied ? 'C' : 'M';
  return { path, index: status, worktree: status, conflict: false };
}
