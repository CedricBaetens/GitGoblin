import type { T3ModelOption, T3ModelProvider, T3ModelSelection } from './types';

export const defaultConversationModel = 'gpt-6.1-sol';
export interface ChatModelChoice {
  value: string;
  label: string;
  selection: T3ModelSelection;
  settings: T3ModelOption[];
}
export function chatModelChoices(providers: T3ModelProvider[], saved: (T3ModelSelection | null | undefined)[]) {
  const choices = new Map<string, ChatModelChoice>();
  function add(selection: T3ModelSelection, label: string, settings: T3ModelOption[] = []) {
    const base = { instanceId: selection.instanceId, model: selection.model };
    const value = JSON.stringify(base);
    if (!choices.has(value)) choices.set(value, { value, label, selection: base,
      settings: settings.filter(option => ['reasoningEffort', 'effort', 'serviceTier'].includes(option.id)) });
  }
  for (const provider of providers) {
    if (provider.enabled === false || provider.installed === false) continue;
    for (const model of provider.models) add({ instanceId: provider.instanceId, model: model.slug },
      `${model.name} · ${provider.displayName || provider.instanceId}`, model.capabilities?.optionDescriptors);
  }
  for (const selection of saved) if (selection) add(selection, `${selection.model} · ${selection.instanceId}`);
  return [...choices.values()].sort((a, b) => Number(b.selection.model === defaultConversationModel) - Number(a.selection.model === defaultConversationModel)
    || a.label.localeCompare(b.label));
}
export function preferredChatModel(choices: ChatModelChoice[], fallback?: T3ModelSelection) {
  return choices.find(choice => choice.selection.model === defaultConversationModel && choice.selection.instanceId === fallback?.instanceId)?.value
    || choices.find(choice => choice.selection.model === defaultConversationModel)?.value
    || choices.find(choice => choice.selection.instanceId === fallback?.instanceId && choice.selection.model === fallback.model)?.value
    || choices[0]?.value || '';
}
export function modelSettingDefaults(settings: T3ModelOption[]) {
  return Object.fromEntries(settings.map(setting => [setting.id, setting.currentValue
    ?? (setting.type === 'select' ? setting.options.find(option => option.isDefault)?.id || '' : false)]));
}
export function chatModelSelection(choice: ChatModelChoice, settings: Record<string, string | boolean>): T3ModelSelection {
  const options = choice.settings.flatMap(setting => {
    const value = settings[setting.id];
    const valid = setting.type === 'boolean' ? typeof value === 'boolean'
      : typeof value === 'string' && setting.options.some(option => option.id === value);
    return valid ? [{ id: setting.id, value: value! }] : [];
  });
  return { ...choice.selection, ...(options.length ? { options } : {}) };
}
