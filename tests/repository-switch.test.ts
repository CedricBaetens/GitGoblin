import { expect, it, vi } from 'vitest';
import { effectScope } from 'vue';
import { useWorkbench } from '../app/composables/useWorkbench';
import { demoSnapshot } from '../app/lib/demo';
import { git } from '../app/lib/native';

vi.mock('vue', async (original) => ({ ...await original<typeof import('vue')>(), onMounted: vi.fn(), onUnmounted: vi.fn() }));
vi.mock('../app/lib/native', () => ({ desktop: () => true, git: vi.fn(), invoke: vi.fn(async () => []) }));

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
