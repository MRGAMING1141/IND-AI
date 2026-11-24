import test from 'node:test';
import assert from 'node:assert/strict';
import { ChatJobStore } from './chatJobStore.ts';

test('ChatJobStore tracks running tasks, deltas, replacements, and completion', () => {
  const store = new ChatJobStore(60_000);
  const job = store.createJob('fb_user_1', 1000);

  store.upsertTask(
    job.id,
    {
      id: 'step_1',
      label: 'Understanding prompt intent',
      status: 'running',
      startedAt: '2026-01-01T00:00:00.000Z',
    },
    1100
  );
  store.upsertTask(
    job.id,
    {
      id: 'step_1',
      label: 'Understanding prompt intent',
      status: 'done',
      startedAt: '2026-01-01T00:00:00.000Z',
      durationMs: 100,
    },
    1200
  );
  store.appendDelta(job.id, 'Hello ', 1300);
  store.appendDelta(job.id, 'world', 1400);

  const running = store.getJobForUser(job.id, 'fb_user_1', 1500);
  assert.ok(running);
  assert.equal(running.status, 'running');
  assert.equal(running.tasks.length, 1);
  assert.equal(running.tasks[0].status, 'done');
  assert.equal(running.partialText, 'Hello world');

  store.replaceText(job.id, 'Upgraded output', 1600);
  store.completeJob(job.id, { reply: 'Upgraded output' }, 1700);

  const completed = store.getJobForUser(job.id, 'fb_user_1', 1800);
  assert.ok(completed);
  assert.equal(completed.status, 'done');
  assert.equal(completed.payload?.reply, 'Upgraded output');
});

test('ChatJobStore enforces strict per-user isolation and TTL expiry', () => {
  const store = new ChatJobStore(5_000);
  const job = store.createJob('fb_alice', 10_000);

  // Another user must never see Alice's job
  assert.equal(store.getJobForUser(job.id, 'fb_bob', 11_000), null);
  assert.ok(store.getJobForUser(job.id, 'fb_alice', 11_000));

  // Expired job is pruned
  assert.equal(store.getJobForUser(job.id, 'fb_alice', 20_000), null);
});

test('ChatJobStore authorizes polling via cryptographic jobToken even when iframe blocks guest cookies', () => {
  const store = new ChatJobStore(60_000);
  const job = store.createJob('guest_cookie_a', 1000);
  store.addMemory(job.id, {
    id: 'mem_1',
    content: 'Prefers TypeScript',
    category: 'preference',
    createdAt: '2026-01-01T00:00:00.000Z',
  }, 1100);

  // Guest cookie changed (iframe blocked Set-Cookie), but valid jobToken succeeds
  const resumed = store.getJobForUser(job.id, 'guest_cookie_b', 1200, job.token);
  assert.ok(resumed);
  assert.equal(resumed.savedMemories.length, 1);

  // Wrong or missing token from another user is strictly rejected
  assert.equal(store.getJobForUser(job.id, 'guest_cookie_b', 1200, '0'.repeat(48)), null);
  assert.equal(store.getJobForUser(job.id, 'guest_cookie_b', 1200), null);
});
