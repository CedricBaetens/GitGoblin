import type { T3Skill } from './types';

export function skillTrigger(text: string, cursor: number) {
  const match = /(?:^|\s)\/([\w.:-]*)$/.exec(text.slice(0, cursor));
  return match ? { query: match[1]!, start: cursor - match[1]!.length - 1, end: cursor } : null;
}

export function availableSkills(provider: { skills?: T3Skill[]; workspaceSnapshots?: { cwd: string; skills: T3Skill[] }[] } | undefined, cwd: string) {
  const normalize = (path: string) => path.replaceAll('\\', '/').replace(/\/+$/, '');
  const skills = provider?.workspaceSnapshots?.find(snapshot => normalize(snapshot.cwd) === normalize(cwd))?.skills ?? provider?.skills ?? [];
  const names = new Set<string>();
  return skills.filter(skill => {
    const key = skill.name.toLowerCase();
    if (!skill.enabled || skill.userInvocable === false || names.has(key)) return false;
    names.add(key);
    return true;
  }).sort((a, b) => a.name.localeCompare(b.name));
}

export function searchSkills(skills: T3Skill[], query: string) {
  const value = query.trim().toLowerCase();
  const rank = (skill: T3Skill) => {
    const names = [skill.name, skill.name.split(':').at(-1), skill.displayName]
      .filter((name): name is string => !!name).map(name => name.toLowerCase());
    if (names.some(name => name === value)) return 0;
    if (names.some(name => name.startsWith(value))) return 1;
    if (names.some(name => name.includes(value))) return 2;
    if ([skill.shortDescription, skill.description].some(text => text?.toLowerCase().includes(value))) return 3;
    return 4;
  };
  return skills.map(skill => ({ skill, rank: rank(skill) })).filter(item => item.rank < 4)
    .sort((a, b) => a.rank - b.rank || a.skill.name.localeCompare(b.skill.name))
    .map(item => item.skill);
}

export function insertSkill(text: string, trigger: { start: number; end: number }, name: string) {
  // T3's skill menu inserts a provider-native $ mention, rather than a slash command.
  const replacement = `$${name} `;
  const end = text[trigger.end] === ' ' ? trigger.end + 1 : trigger.end;
  return { text: text.slice(0, trigger.start) + replacement + text.slice(end), cursor: trigger.start + replacement.length };
}
