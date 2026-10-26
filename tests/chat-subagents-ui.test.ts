// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { compileScript, parse } from '@vue/compiler-sfc';
import { ModuleKind, transpile } from 'typescript';
import * as Vue from 'vue';
import * as Icons from 'lucide-vue-next';
import { expect, it } from 'vitest';

it('keeps subagent cards visible and updates progress and expandable results on completion', async () => {
  const { descriptor } = parse(readFileSync('app/components/ChatSubagents.vue', 'utf8'));
  const compiled = compileScript(descriptor, { id: 'subagents', inlineTemplate: true });
  const exports: any = {};
  const modules: Record<string, unknown> = { vue: Vue, 'lucide-vue-next': Icons };
  new Function('require', 'exports', transpile(compiled.content, { module: ModuleKind.CommonJS }))((name: string) => modules[name], exports);
  const agents = Vue.reactive([{ id: 'review', title: 'Review changes', status: 'running', model: 'review-model', progress: 'Reading files', result: '' }]);
  const host = document.createElement('div');
  const app = Vue.createApp(exports.default, { agents });
  app.component('ChatMarkdown', { props: ['text'], setup: props => () => Vue.h('div', props.text) });
  app.mount(host);
  try {
    expect(host.textContent).toContain('1 active');
    expect(host.textContent).toContain('Review changes');
    expect(host.textContent).toContain('review-model');
    expect(host.textContent).toContain('Reading files');
    expect(host.querySelector('details')).toBeNull();
    agents[0]!.status = 'completed';
    agents[0]!.result = 'No issues found';
    await Vue.nextTick();
    expect(host.textContent).toContain('Completed');
    expect(host.textContent).not.toContain('1 active');
    expect(host.querySelector('summary')?.textContent).toBe('View result');
    expect(host.querySelector('details')?.textContent).toContain('No issues found');
  } finally { app.unmount(); }
});
