import { expect, it, vi } from 'vitest';
import { effectScope } from 'vue';
import { useWorkbench } from '../app/composables/useWorkbench';
import { demoSnapshot } from '../app/lib/demo';
import { git } from '../app/lib/native';

vi.mock('vue', async original => ({ ...await original<typeof import('vue')>(), onMounted: vi.fn(), onUnmounted: vi.fn() }));
vi.mock('../app/lib/native', () => ({ desktop: () => true, git: vi.fn(), invoke: vi.fn() }));

it.each(['working', 'staged'])('updates %s file lists without waiting for metadata, history or the next diff', async mode => {
  const file = { path: 'file.txt', index: mode === 'staged' ? 'M' : ' ', worktree: mode === 'staged' ? ' ' : 'M', conflict: false };
  vi.mocked(git).mockImplementation(async request => {
    if (request.action === 'diff') return { text: '+reviewed', fingerprint: 'reviewed' };
    if (request.action === 'stage' || request.action === 'unstage') return 'Index updated';
    if (request.action === 'status') return [];
    if (request.action === 'snapshot') return { ...demoSnapshot, files: [] };
    return [];
  });
  const scope = effectScope();
  const w = scope.run(() => useWorkbench())!;
  w.repo.value = demoSnapshot.root;
  w.snapshot.value = { ...demoSnapshot, files: [file] };
  w.selected.value = file.path;
  w.mode.value = mode;
  await w.loadDiff();
  vi.mocked(git).mockClear();
  await w.stageFiles([file.path], mode);
  expect(w.snapshot.value.files).toEqual([]);
  expect(w.busy.value).toBe(false);
  expect(vi.mocked(git).mock.calls.map(([request]) => request.action)).toEqual([mode === 'staged' ? 'unstage' : 'stage', 'status']);
  expect(vi.mocked(git).mock.calls[0]![0].fingerprint).toBe('reviewed');
  scope.stop();
});

it('makes the next staging action available while the next file diff is still loading', async () => {
  const file = (path: string) => ({ path, index: ' ', worktree: 'M', conflict: false });
  let finishDiff!: (value: { text: string; fingerprint: string }) => void;
  vi.mocked(git).mockImplementation(async request => {
    if (request.action === 'stage') return 'Index updated';
    if (request.action === 'status') return [file('next.txt')];
    if (request.path === 'next.txt') return new Promise(done => { finishDiff = done; });
    return { text: '+reviewed', fingerprint: 'reviewed' };
  });
  const scope = effectScope();
  const w = scope.run(() => useWorkbench())!;
  w.repo.value = demoSnapshot.root;
  w.snapshot.value = { ...demoSnapshot, files: [file('first.txt'), file('next.txt')] };
  w.selected.value = 'first.txt';
  await w.loadDiff();
  await w.stageFiles(['first.txt'], 'working');
  expect(w.selected.value).toBe('next.txt');
  expect(w.busy.value).toBe(false);
  expect(w.diffLoading.value).toBe(true);
  finishDiff({ text: '+next', fingerprint: 'next' });
  await Promise.resolve();
  scope.stop();
});

it('refreshes the list after a partial failure without hiding the failure', async () => {
  vi.mocked(git).mockImplementation(async request => {
    if (request.action === 'stage') throw new Error('File changed since review');
    if (request.action === 'status') return [];
    return { text: '+reviewed', fingerprint: 'reviewed' };
  });
  const scope = effectScope();
  const w = scope.run(() => useWorkbench())!;
  w.repo.value = demoSnapshot.root;
  w.snapshot.value = { ...demoSnapshot, files: [] };
  await expect(w.stageFiles(['file.txt'], 'working')).rejects.toThrow('0 of 1 files staged');
  expect(w.error.value).toContain('File changed since review');
  expect(w.busy.value).toBe(false);
  expect(vi.mocked(git).mock.lastCall?.[0].action).toBe('status');
  scope.stop();
});

it.each(['stage', 'unstage', 'patch'])('uses the fast refresh for the diff viewer %s action too', async action => {
  vi.mocked(git).mockImplementation(async request => request.action === 'status' ? [] : 'Index updated');
  const scope = effectScope();
  const w = scope.run(() => useWorkbench())!;
  w.repo.value = demoSnapshot.root;
  w.snapshot.value = { ...demoSnapshot, files: [] };
  vi.mocked(git).mockClear();
  await w.mutate(action, { path: 'file.txt', fingerprint: 'reviewed' });
  expect(vi.mocked(git).mock.calls.map(([request]) => request.action)).toEqual([action, 'status']);
  scope.stop();
});

it.each(['working', 'staged'])('handles 598 %s files with one bulk mutation and one status refresh', async mode => {
  vi.mocked(git).mockImplementation(async request => request.action === 'status' ? [] : '598 files updated');
  const scope = effectScope();
  const w = scope.run(() => useWorkbench())!;
  w.repo.value = demoSnapshot.root;
  w.snapshot.value = { ...demoSnapshot, files: [] };
  const paths = Array.from({ length: 598 }, (_, i) => `folder/file-${i}.txt`);
  vi.mocked(git).mockClear();
  await w.stageFiles(paths, mode);
  expect(vi.mocked(git).mock.calls.map(([request]) => request.action)).toEqual([mode === 'staged' ? 'unstage-files' : 'stage-files', 'status']);
  expect(vi.mocked(git).mock.calls[0]![0].files?.map(file => file.path)).toEqual(paths);
  expect(w.busy.value).toBe(false);
  scope.stop();
});
