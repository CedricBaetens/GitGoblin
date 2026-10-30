import { expect, it, vi } from 'vitest';
import { effectScope, nextTick } from 'vue';
import { useWorkbench } from '../app/composables/useWorkbench';
import { git } from '../app/lib/native';

vi.mock('vue', async original => ({ ...await original<typeof import('vue')>(), onMounted: vi.fn(), onUnmounted: vi.fn() }));
vi.mock('../app/lib/native', () => ({ desktop: () => true, git: vi.fn(), invoke: vi.fn() }));

it('keeps a cached diff interactive while Git revalidates it', async () => {
  vi.mocked(git).mockResolvedValue({ text: '+cached', fingerprint: 'reviewed' });
  const scope = effectScope();
  const w = scope.run(() => useWorkbench())!;
  try {
    w.repo.value = 'repo';
    w.selected.value = 'first.txt';
    await w.loadDiff();
    w.selected.value = 'second.txt';
    await w.loadDiff();
    let finish!: (value: unknown) => void;
    vi.mocked(git).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    w.selected.value = 'first.txt';
    await nextTick();
    const loading = w.loadDiff();
    const interactive = !w.diffLoading.value;
    expect(w.diff.value.fingerprint).toBe('reviewed');
    finish({ text: '+fresh', fingerprint: 'fresh' });
    await loading;
    expect(w.diff.value.fingerprint).toBe('fresh');
    expect(interactive).toBe(true);
  } finally { scope.stop(); }
});
