// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { compileScript, parse } from '@vue/compiler-sfc';
import { ModuleKind, transpile } from 'typescript';
import * as Vue from 'vue';
import * as Icons from 'lucide-vue-next';
import * as queue from '../app/lib/chat-queue';
import { expect, it, vi } from 'vitest';

it('renders the production queue controls and sends edits, reorder, steer and cancel commands', async () => {
  const { descriptor } = parse(readFileSync('app/components/ChatQueue.vue', 'utf8'));
  const compiled = compileScript(descriptor, { id: 'queue', inlineTemplate: true });
  const exports: any = {};
  new Function('require', 'exports', transpile(compiled.content, { module: ModuleKind.CommonJS }))(
    (name: string) => ({ vue: Vue, 'lucide-vue-next': Icons, '~/lib/chat-queue': queue })[name], exports);
  const dispatch = vi.fn().mockResolvedValue({});
  const projection = Vue.reactive({ thread: { id: 'thread', activeRunId: 'active' }, messages: [{ id: 'message', text: 'Pending instruction' }],
    runs: [{ id: 'queued', userMessageId: 'message', status: 'queued', queuePosition: 1, queueHeld: true },
      { id: 'second', userMessageId: 'other', status: 'queued', queuePosition: 2 }] });
  const host = document.createElement('div');
  document.body.append(host);
  const app = Vue.createApp(exports.default, { projection, dispatch, disabled: false });
  app.component('AppButton', { setup: (_, { slots }) => () => Vue.h('button', slots.default?.()) });
  app.component('AppTextarea', { props: ['modelValue'], emits: ['update:modelValue'], setup: (props, { emit }) => () => Vue.h('textarea', { value: props.modelValue, onInput: (event: Event) => emit('update:modelValue', (event.target as HTMLTextAreaElement).value) }) });
  app.mount(host);
  const flush = async () => { await Promise.resolve(); await Vue.nextTick(); };
  const click = async (label: string) => { (host.querySelector(`[aria-label="${label}"]`) as HTMLElement).click(); await flush(); };
  try {
    expect(host.textContent).toContain('Pending instruction');
    await click('Edit queued message');
    const textarea = host.querySelector('textarea')!;
    textarea.value = 'Revised instruction';
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    await flush();
    (Array.from(host.querySelectorAll('button')).find(button => button.textContent === 'Save')!).click();
    await flush();
    expect(dispatch).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'queued-run.edit', threadId: 'thread', runId: 'queued', text: 'Revised instruction' }));
    (host.querySelector('[aria-label^="Reorder"]')!).dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }));
    await flush();
    expect(dispatch).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'queued-run.reorder', runId: 'queued', beforeRunId: null }));
    await click('Steer queued message');
    expect(dispatch).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'queued-message.promote-to-steer', queuedRunId: 'queued', targetRunId: 'active' }));
    await click('Remove queued message');
    expect(dispatch).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'queued-run.cancel', runId: 'queued' }));
    projection.runs[0]!.status = 'cancelled';
    await flush();
    expect(host.textContent).not.toContain('Pending instruction');
  } finally { app.unmount(); host.remove(); }
});
