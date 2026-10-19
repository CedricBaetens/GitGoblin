export interface ChangeRange { start: number; end: number }

// Offsets use UTF-16 like string.slice; compare code points to keep emoji intact.
export function inlineChanges(before: string, after: string): { old: ChangeRange[]; next: ChangeRange[] } {
  const left = Array.from(before), right = Array.from(after);
  let prefix = 0, suffix = 0;
  while (prefix < left.length && prefix < right.length && left[prefix] === right[prefix]) prefix++;
  while (suffix < left.length - prefix && suffix < right.length - prefix && left[left.length - suffix - 1] === right[right.length - suffix - 1]) suffix++;
  const a = left.slice(prefix, left.length - suffix), b = right.slice(prefix, right.length - suffix);
  const oldChanged = new Set<number>(), nextChanged = new Set<number>();
  // Bound work for generated/minified lines; retain their common prefix/suffix.
  if (a.length * b.length > 250_000) {
    a.forEach((_, i) => oldChanged.add(prefix + i));
    b.forEach((_, i) => nextChanged.add(prefix + i));
  } else {
    const width = b.length + 1;
    const lengths = new Uint32Array((a.length + 1) * width);
    for (let i = a.length - 1; i >= 0; i--)
      for (let j = b.length - 1; j >= 0; j--)
        lengths[i * width + j] = a[i] === b[j] ? 1 + lengths[(i + 1) * width + j + 1]!
          : Math.max(lengths[(i + 1) * width + j]!, lengths[i * width + j + 1]!);
    let i = 0, j = 0;
    while (i < a.length || j < b.length) {
      if (i < a.length && j < b.length && a[i] === b[j]) { i++; j++; }
      else if (i < a.length && (j === b.length || lengths[(i + 1) * width + j]! >= lengths[i * width + j + 1]!)) oldChanged.add(prefix + i++);
      else nextChanged.add(prefix + j++);
    }
  }
  function ranges(characters: string[], changed: Set<number>) {
    const result: ChangeRange[] = [];
    let offset = 0;
    characters.forEach((character, index) => {
      if (changed.has(index)) {
        const last = result.at(-1);
        if (last?.end === offset) last.end += character.length;
        else result.push({ start: offset, end: offset + character.length });
      }
      offset += character.length;
    });
    return result;
  }
  return { old: ranges(left, oldChanged), next: ranges(right, nextChanged) };
}
