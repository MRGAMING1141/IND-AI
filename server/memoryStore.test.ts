import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStore } from './memoryStore.ts';

test('MemoryStore isolates facts per user, deduplicates case-insensitively, and deletes cleanly', () => {
  const store = new MemoryStore();

  const fact1 = store.addFact('user-a', 'Prefers single-file HTML tools', 'preference');
  const dup = store.addFact('user-a', '  prefers single-file html tools  ', 'preference');
  assert.equal(fact1.id, dup.id);
  assert.equal(store.listFacts('user-a').length, 1);
  assert.equal(store.listFacts('user-b').length, 0);

  store.addFact('user-b', 'Building a Roblox game in Luau', 'project');
  assert.equal(store.listFacts('user-b').length, 1);

  assert.equal(store.deleteFact('user-a', fact1.id), true);
  assert.equal(store.listFacts('user-a').length, 0);
  assert.equal(store.listFacts('user-b').length, 1);
});
