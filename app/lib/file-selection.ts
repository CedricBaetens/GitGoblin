export function selectFiles(
  visible: string[], selected: Set<string>, anchor: string, path: string,
  modifiers: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean },
) {
  const additive = modifiers.ctrlKey || modifiers.metaKey;
  if (modifiers.shiftKey && visible.includes(anchor)) {
    const from = visible.indexOf(anchor), to = visible.indexOf(path);
    const range = visible.slice(Math.min(from, to), Math.max(from, to) + 1);
    return { paths: new Set(additive ? [...selected, ...range] : range), anchor };
  }
  const paths = additive ? new Set(selected) : new Set<string>();
  if (additive && paths.has(path)) paths.delete(path);
  else paths.add(path);
  return { paths, anchor: path };
}
