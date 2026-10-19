import { expect, it, vi } from 'vitest';
import { effectScope } from 'vue';
import { useWorkbench } from '../app/composables/useWorkbench';
import { demoSnapshot } from '../app/lib/demo';
import { desktop, git, invoke } from '../app/lib/native';

vi.mock('vue', async (original) => ({ ...await original<typeof import('vue')>(), onMounted: vi.fn(), onUnmounted: vi.fn() }));
vi.mock('../app/lib/native', () => ({ desktop: vi.fn(() => true), git: vi.fn(), invoke: vi.fn(async () => []) }));

it('removes only the saved recent and favorite links while keeping the current workspace open', async () => {
  vi.mocked(invoke).mockClear();
  vi.mocked(git).mockClear();
  const scope = effectScope();
  const workbench = scope.run(() => useWorkbench())!;
  workbench.repo.value = demoSnapshot.root;
  workbench.snapshot.value = structuredClone(demoSnapshot);
  workbench.recent.value = [demoSnapshot.root, 'D:/keep'];
  workbench.favorites.value = [demoSnapshot.root, 'D:/favorite'];

  await workbench.removeRepository(demoSnapshot.root.toUpperCase().replaceAll('/', '\\') + '\\');

  expect(workbench.recent.value).toEqual(['D:/keep']);
  expect(workbench.favorites.value).toEqual(['D:/favorite']);
  expect(workbench.repo.value).toBe(demoSnapshot.root);
  expect(workbench.snapshot.value?.root).toBe(demoSnapshot.root);
  expect(vi.mocked(invoke).mock.calls).toEqual([
    ['favorites_save', { repositories: ['D:/favorite'] }],
    ['repositories_save', { repositories: ['D:/keep'] }],
  ]);
  expect(git).not.toHaveBeenCalled();
  expect(workbench.busy.value).toBe(false);
  scope.stop();
});

it('keeps the entry and reports the error when saving repository history fails', async () => {
  vi.mocked(invoke).mockImplementation(async command => {
    if (command === 'repositories_save') throw new Error('Disk full');
    return [];
  });
  const scope = effectScope();
  const workbench = scope.run(() => useWorkbench())!;
  workbench.recent.value = ['D:/keep'];
  await workbench.removeRepository('D:/keep');
  expect(workbench.recent.value).toEqual(['D:/keep']);
  expect(workbench.error.value).toContain('Disk full');
  expect(workbench.busy.value).toBe(false);
  expect(workbench.favoriteSaving.value).toBe(false);
  vi.mocked(invoke).mockResolvedValue([]);
  scope.stop();
});

it('persists removal in browser preferences too', async () => {
  vi.mocked(desktop).mockReturnValue(false);
  const setItem = vi.fn();
  vi.stubGlobal('localStorage', { setItem });
  const scope = effectScope();
  const workbench = scope.run(() => useWorkbench())!;
  workbench.recent.value = ['D:/remove', 'D:/keep'];
  workbench.favorites.value = ['D:/remove'];
  await workbench.removeRepository('D:/remove');
  expect(setItem.mock.calls).toEqual([
    ['gitgoblin.favorites', '[]'],
    ['gitgoblin.repositories', '["D:/keep"]'],
  ]);
  vi.mocked(desktop).mockReturnValue(true);
  vi.unstubAllGlobals();
  scope.stop();
});

it('keeps the current workspace visible and blocks mutations until the next snapshot is ready', async () => {
  let resolve!: (value: typeof demoSnapshot) => void;
  const next = { ...demoSnapshot, root: 'D:/next', files: [] };
  vi.mocked(git).mockImplementation(async request => request.action === 'snapshot' ? new Promise(done => { resolve = done; }) : []);
  const scope = effectScope();
  const workbench = scope.run(() => useWorkbench())!;
  workbench.repo.value = demoSnapshot.root;
  workbench.snapshot.value = structuredClone(demoSnapshot);
  const switching = workbench.openRepo(next.root);
  expect(workbench.snapshot.value?.root).toBe(demoSnapshot.root);
  expect(workbench.repo.value).toBe(demoSnapshot.root);
  expect(workbench.busy.value).toBe(true);
  await expect(workbench.mutate('stage')).rejects.toThrow('Wait');
  resolve(next);
  await switching;
  expect(workbench.snapshot.value?.root).toBe(next.root);
  expect(workbench.repo.value).toBe(next.root);
  expect(workbench.busy.value).toBe(false);
  scope.stop();
});

it('keeps the previous repository open if the new repository cannot load', async () => {
  vi.mocked(git).mockRejectedValue(new Error('Repository unavailable'));
  const scope = effectScope();
  const workbench = scope.run(() => useWorkbench())!;
  workbench.repo.value = demoSnapshot.root;
  workbench.snapshot.value = structuredClone(demoSnapshot);
  await workbench.openRepo('D:/missing');
  expect(workbench.repo.value).toBe(demoSnapshot.root);
  expect(workbench.snapshot.value?.root).toBe(demoSnapshot.root);
  expect(workbench.error.value).toContain('Repository unavailable');
  expect(workbench.busy.value).toBe(false);
  scope.stop();
});
