import { expect, it } from 'vitest';
import { chatModelChoices, chatModelSelection, modelSettingDefaults, preferredChatModel } from '../app/lib/chat-models';
import type { T3ModelProvider } from '../app/lib/types';

const providers: T3ModelProvider[] = [{ instanceId: 'codex', displayName: 'Codex', models: [
  { slug: 'gpt-6-astra', name: 'GPT-6 Astra' },
  { slug: 'gpt-6.1-sol', name: 'GPT-6.1 Sol', capabilities: { optionDescriptors: [
    { id: 'reasoningEffort', label: 'Reasoning', type: 'select', currentValue: 'medium', options: [
      { id: 'low', label: 'Low' }, { id: 'medium', label: 'Medium' }, { id: 'high', label: 'High' },
    ] },
    { id: 'serviceTier', label: 'Service tier', type: 'select', options: [
      { id: 'default', label: 'Standard', isDefault: true }, { id: 'fast', label: 'Fast' },
    ] },
  ] } },
] }];
it('prefers 6.1-sol over a project default and deduplicates saved selections with different options', () => {
  const choices = chatModelChoices(providers, [{ instanceId: 'codex', model: 'gpt-6.1-sol', options: [{ id: 'reasoningEffort', value: 'low' }] }]);
  expect(choices).toHaveLength(2);
  expect(JSON.parse(preferredChatModel(choices, { instanceId: 'codex', model: 'gpt-6-astra' })).model).toBe('gpt-6.1-sol');
  expect(choices[0]!.settings).toHaveLength(2);
});
it('keeps configured models usable when the catalog cannot be loaded', () => {
  const fallback = { instanceId: 'custom', model: 'configured' };
  const choices = chatModelChoices([], [fallback, null]);
  expect(JSON.parse(preferredChatModel(choices, fallback))).toEqual(fallback);
  expect(preferredChatModel([], fallback)).toBe('');
});
it('uses provider defaults and includes chosen reasoning and tier in the wire selection', () => {
  const choice = chatModelChoices(providers, [])[0]!;
  expect(modelSettingDefaults(choice.settings)).toEqual({ reasoningEffort: 'medium', serviceTier: 'default' });
  expect(chatModelSelection(choice, { reasoningEffort: 'high', serviceTier: 'fast' })).toEqual({
    instanceId: 'codex', model: 'gpt-6.1-sol', options: [
      { id: 'reasoningEffort', value: 'high' }, { id: 'serviceTier', value: 'fast' },
    ],
  });
});
it('does not send unsupported settings or carry them into a different model', () => {
  const choices = chatModelChoices(providers, []);
  expect(chatModelSelection(choices[0]!, { reasoningEffort: 'unsupported', serviceTier: 'unknown' }).options).toBeUndefined();
  expect(chatModelSelection(choices[1]!, { reasoningEffort: 'high', serviceTier: 'fast' }).options).toBeUndefined();
  const disabled = chatModelChoices([{ ...providers[0]!, enabled: false }], []);
  expect(disabled).toEqual([]);
});
