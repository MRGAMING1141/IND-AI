import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_SKILLS,
  MAX_CUSTOM_INSTRUCTIONS_CHARS,
  clampCustomInstructions,
  detectSlashQuery,
  filterSkills,
  normalizeSkillCommand,
  resolveSkillInvocation,
  validateCustomSkillInput,
} from './skillsEngine.ts';

test('DEFAULT_SKILLS contains all 5 requested default skills', () => {
  const cmds = DEFAULT_SKILLS.map((s) => s.command);
  assert.deepEqual(cmds, ['/prompt', '/luau', '/email', '/debug', '/audit']);
  const promptSkill = DEFAULT_SKILLS.find((s) => s.command === '/prompt');
  assert.equal(promptSkill?.name, 'Make Prompt');
  assert.equal(promptSkill?.isPromptEngineer, true);
});

test('detectSlashQuery opens palette for / prefix and closes after space', () => {
  assert.equal(detectSlashQuery('/'), '');
  assert.equal(detectSlashQuery('/pr'), 'pr');
  assert.equal(detectSlashQuery('/luau'), 'luau');
  assert.equal(detectSlashQuery('/prompt build app'), null);
  assert.equal(detectSlashQuery('hello /prompt'), null);
  assert.equal(detectSlashQuery(''), null);
});

test('filterSkills matches by command, name, or description', () => {
  assert.equal(filterSkills(DEFAULT_SKILLS, '').length, 5);
  assert.equal(filterSkills(DEFAULT_SKILLS, 'prompt')[0]?.command, '/prompt');
  assert.equal(filterSkills(DEFAULT_SKILLS, 'roblox')[0]?.command, '/luau');
  assert.equal(filterSkills(DEFAULT_SKILLS, 'security')[0]?.command, '/audit');
});

test('resolveSkillInvocation expands matched skills and preserves clean displayContent', () => {
  const res = resolveSkillInvocation('/prompt create an invoice app', DEFAULT_SKILLS);
  assert.equal(res.matchedSkill?.command, '/prompt');
  assert.equal(res.displayContent, '/prompt create an invoice app');
  assert.ok(res.expandedPrompt.includes('[ACTIVE SKILL: /prompt — Make Prompt]'));
  assert.ok(res.expandedPrompt.includes('create an invoice app'));
  assert.equal(res.skipAutoCodeVerify, true);

  const debugRes = resolveSkillInvocation('/debug TypeError undefined', DEFAULT_SKILLS);
  assert.equal(debugRes.matchedSkill?.command, '/debug');
  assert.equal(debugRes.recommendedMode, 'coding');
  assert.equal(debugRes.forceDebugLoop, true);

  const emailRes = resolveSkillInvocation('/email remind client in Hindi', DEFAULT_SKILLS);
  assert.equal(emailRes.recommendedMode, 'business');

  const normal = resolveSkillInvocation('hello world', DEFAULT_SKILLS);
  assert.equal(normal.matchedSkill, null);
  assert.equal(normal.expandedPrompt, 'hello world');
});

test('validateCustomSkillInput rejects duplicates, invalid commands, and oversized instructions', () => {
  assert.equal(normalizeSkillCommand(' SQL '), '/sql');

  const dup = validateCustomSkillInput(
    {
      command: '/prompt',
      name: 'Duplicate',
      description: 'Desc',
      mode: 'auto',
      instructions: 'Do something',
    },
    DEFAULT_SKILLS
  );
  assert.equal(dup.ok, false);

  const badCmd = validateCustomSkillInput(
    {
      command: '/123',
      name: 'Bad',
      description: 'Desc',
      mode: 'auto',
      instructions: 'Do something',
    },
    DEFAULT_SKILLS
  );
  assert.equal(badCmd.ok, false);

  const valid = validateCustomSkillInput(
    {
      command: 'sql',
      name: 'SQL Optimizer',
      description: 'Optimizes PostgreSQL queries and indexes.',
      mode: 'coding',
      instructions: 'Rewrite the SQL query with indexes and EXPLAIN notes.',
      placeholder: 'paste SQL query',
    },
    DEFAULT_SKILLS
  );
  assert.equal(valid.ok, true);
  if (valid.ok) {
    assert.equal(valid.normalized.command, '/sql');
    assert.equal(valid.normalized.mode, 'coding');
  }
});

test('clampCustomInstructions strictly caps at 1500 characters', () => {
  assert.equal(MAX_CUSTOM_INSTRUCTIONS_CHARS, 1500);
  const longText = 'A'.repeat(2400);
  assert.equal(clampCustomInstructions(longText).length, 1500);
  assert.equal(clampCustomInstructions('  Prefer TypeScript  '), 'Prefer TypeScript');
  assert.equal(clampCustomInstructions(null), '');
});
