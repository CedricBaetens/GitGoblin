import { describe, expect, it } from 'vitest';
import { diffFileStatus } from '../app/lib/diff-files';
import { parseDiffFiles } from '../app/lib/diff';

describe('changed file navigation', () => {
  it('excludes commit metadata and preserves global line indices when selecting a file', () => {
    const files = parseDiffFiles('commit abc\n\ndiff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1 +1 @@\n-old\n+new\ndiff --git a/src/b.ts b/src/b.ts\n--- a/src/b.ts\n+++ b/src/b.ts\n@@ -1 +1 @@\n-before\n+after\n');
    expect(files.map(file => diffFileStatus(file.header)?.path)).toEqual([undefined, 'src/a.ts', 'src/b.ts']);
    const selected = files.filter(file => diffFileStatus(file.header)?.path === 'src/b.ts');
    expect(selected[0].hunks[0].lines[0].index).toBe(12);
  });
  it.each([
    ['diff --git a/old.txt b/new.txt\nsimilarity index 100%\nrename from old.txt\nrename to new.txt', 'new.txt', 'R'],
    ['diff --git a/removed.txt b/removed.txt\ndeleted file mode 100644\n--- a/removed.txt\n+++ /dev/null', 'removed.txt', 'D'],
    ['diff --git a/image.png b/image.png\nBinary files a/image.png and b/image.png differ', 'image.png', 'M'],
    ['diff --git a/space name.txt b/space name.txt\nnew file mode 100644\n--- /dev/null\n+++ b/space name.txt', 'space name.txt', 'A'],
    ['diff --git "a/caf\\303\\251.txt" "b/caf\\303\\251.txt"\n--- "a/caf\\303\\251.txt"\n+++ "b/caf\\303\\251.txt"', 'café.txt', 'M'],
  ])('reads paths and status from git headers', (header, path, status) => {
    expect(diffFileStatus(header)).toMatchObject({ path, index: status });
  });
});

