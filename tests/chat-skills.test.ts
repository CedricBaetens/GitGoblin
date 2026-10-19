import { expect, it } from 'vitest';
import { availableSkills, insertSkill, searchSkills, skillTrigger } from '../app/lib/chat-skills';
import type { T3Skill } from '../app/lib/types';
const skill = (name: string, extra: Partial<T3Skill> = {}): T3Skill => ({ name, enabled: true, path: `C:/${name}/SKILL.md`, ...extra });

it('detects a slash query at the caret without interpreting paths and URLs as skills', () => {
  expect(skillTrigger('/', 1)).toEqual({ query: '', start: 0, end: 1 });
  expect(skillTrigger('Please /matt:tri next', 16)).toEqual({ query: 'matt:tri', start: 7, end: 16 });
  for (const text of ['https://example.com', 'app/components/', '/some/path', 'Please /triage '])
    expect(skillTrigger(text, text.length)).toBeNull();
});
it('uses worktree skills, includes user-only invocations, and excludes disabled or agent-only skills', () => {
  const result = availableSkills({ skills: [skill('global')], workspaceSnapshots: [{ cwd: 'D:\\worktree', skills: [
    skill('triage'), skill('TRIAGE'), skill('disabled', { enabled: false }), skill('agent-only', { userInvocable: false }),
  ] }] }, 'D:/worktree/');
  expect(result.map(item => item.name)).toEqual(['triage']);
  expect(availableSkills({ skills: [skill('global')], workspaceSnapshots: [{ cwd: 'D:/worktree', skills: [] }] }, 'D:/worktree')).toEqual([]);
});
it('searches names and descriptions and preserves the surrounding draft when inserting a native skill mention', () => {
  const skills = [skill('debug', { description: 'Triage a failure' }), skill('triage')];
  expect(searchSkills(skills, 'TRI').map(item => item.name)).toEqual(['triage', 'debug']);
  expect(insertSkill('Please /tri next', { start: 7, end: 11 }, 'mattpocock-skills:triage')).toEqual({
    text: 'Please $mattpocock-skills:triage next', cursor: 33,
  });
});
