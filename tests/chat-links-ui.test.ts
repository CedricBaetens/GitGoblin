// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { compileScript, parse } from '@vue/compiler-sfc';
import { ModuleKind, transpile } from 'typescript';
import * as Vue from 'vue';
import * as markdown from '../app/lib/markdown';
import { expect, it, vi } from 'vitest';

it('opens a rendered chat link through the desktop host instead of a webview popup', async () => {
  const invoke = vi.fn().mockResolvedValue(undefined);
  const { descriptor } = parse(readFileSync('app/components/ChatMarkdown.vue', 'utf8'));
  const compiled = compileScript(descriptor, { id: 'markdown', inlineTemplate: true });
  const exports: any = {};
  new Function('require', 'exports', transpile(compiled.content, { module: ModuleKind.CommonJS }))(
    (name: string) => ({ vue: Vue, '~/lib/markdown': markdown, '~/lib/native': { desktop: () => true, invoke } })[name], exports);
  const host = document.createElement('div');
  const app = Vue.createApp(exports.default, { text: '[Visit **site**](https://example.com/path?q=1#section)' });
  app.component('AppCodeSurface', { setup: (_, { slots }) => () => Vue.h('div', slots.default?.()) });
  app.mount(host);
  try {
    const event = new MouseEvent('click', { bubbles: true, cancelable: true });
    host.querySelector('a strong')!.dispatchEvent(event);
    await Vue.nextTick();
    expect(invoke).toHaveBeenCalledWith('open_external_url', { url: 'https://example.com/path?q=1#section' });
    expect(event.defaultPrevented).toBe(true);
    invoke.mockRejectedValueOnce('Browser unavailable');
    host.querySelector('a')!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await Promise.resolve();
    await Vue.nextTick();
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('Browser unavailable');
  } finally { app.unmount(); }
});
