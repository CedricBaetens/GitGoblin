import { repositoryThreadKey } from './threads';

export function chatWorktreeOptions(trees: { path: string; branch: string }[], current: string, branch?: string | null) {
  const options = trees.map((tree, index) => ({
    path: tree.path,
    label: `${index === 0 ? 'Main checkout' : 'Separate worktree'} · ${tree.branch || 'Detached HEAD'}${index === 0 ? '' : ` · ${tree.path.replaceAll('\\', '/').split('/').filter(Boolean).at(-1)}`}`,
  }));
  const selected = options.find(option => repositoryThreadKey(option.path) === repositoryThreadKey(current));
  if (selected) selected.path = current;
  else options.unshift({ path: current, label: `Current folder${branch ? ` · ${branch}` : ''}` });
  return options;
}
