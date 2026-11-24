import assert from 'node:assert/strict';
import test from 'node:test';
import {
  GUEST_WINDOW_MESSAGE_LIMIT,
  SIGNED_IN_WINDOW_MESSAGE_LIMIT,
  USAGE_WINDOW_MS,
} from '../src/utils/planEngine.ts';
import { UserStore } from './userStore.ts';

test('UserStore enforces 10-msg guest and 20-msg signed-in 5-hour rolling windows and resets after 5 hours', () => {
  const store = new UserStore();
  const t0 = new Date('2026-11-22T10:00:00.000Z');
  const tWithin = new Date(t0.getTime() + 4 * 60 * 60 * 1000); // +4h
  const tReset = new Date(t0.getTime() + USAGE_WINDOW_MS + 1000); // +5h 1s

  // Guest workspace -> 10 messages / 5 hours
  const guestSummary = store.getAccountSummary('u1', t0);
  assert.equal(guestSummary.plan, 'free');
  assert.equal(guestSummary.authType, 'guest');
  assert.equal(guestSummary.usage.used, 0);
  assert.equal(guestSummary.usage.limit, GUEST_WINDOW_MESSAGE_LIMIT);
  assert.equal(guestSummary.usage.windowDurationHours, 5);

  const hyperCheck = store.checkMessageAllowance('u1', 'hyper', t0);
  assert.equal(hyperCheck.allowed, false);
  if (!hyperCheck.allowed) {
    assert.equal(hyperCheck.code, 'PLUS_REQUIRED');
  }

  for (let i = 0; i < GUEST_WINDOW_MESSAGE_LIMIT; i += 1) {
    store.recordMessageUsage('u1', t0);
  }

  const guestLimitCheck = store.checkMessageAllowance('u1', 'standard', tWithin);
  assert.equal(guestLimitCheck.allowed, false);
  if (!guestLimitCheck.allowed) {
    assert.equal(guestLimitCheck.code, 'USAGE_LIMIT_REACHED');
    assert.match(guestLimitCheck.error, /10 messages per 5 hours/i);
  }

  // After 5 hours, usage resets automatically
  const afterResetCheck = store.checkMessageAllowance('u1', 'standard', tReset);
  assert.equal(afterResetCheck.allowed, true);
  assert.equal(store.getAccountSummary('u1', tReset).usage.used, 0);

  // Signed-in Firebase user (fb_*) -> 20 messages / 5 hours
  const signedSummary = store.getAccountSummary('fb_verified123', t0);
  assert.equal(signedSummary.authType, 'google');
  assert.equal(signedSummary.usage.limit, SIGNED_IN_WINDOW_MESSAGE_LIMIT);
  for (let i = 0; i < GUEST_WINDOW_MESSAGE_LIMIT + 5; i += 1) {
    store.recordMessageUsage('fb_verified123', t0);
  }
  assert.equal(store.checkMessageAllowance('fb_verified123', 'standard', tWithin).allowed, true);

  for (let i = 0; i < 5; i += 1) {
    store.recordMessageUsage('fb_verified123', tWithin);
  }
  const signedAtLimit = store.checkMessageAllowance('fb_verified123', 'standard', tWithin);
  assert.equal(signedAtLimit.allowed, false);
  if (!signedAtLimit.allowed) {
    assert.equal(signedAtLimit.code, 'USAGE_LIMIT_REACHED');
    assert.match(signedAtLimit.error, /20 messages per 5 hours/i);
  }
});

test('UserStore hydrateUsageFromCloud restores persisted Firestore usage after simulated server restart and blocks downgrades', () => {
  const t0 = new Date('2026-11-22T10:00:00.000Z');
  const t1 = new Date(t0.getTime() + 60 * 60 * 1000); // +1h

  // Simulate server restart: brand new empty UserStore instance
  const restartedStore = new UserStore();
  const hydrated = restartedStore.hydrateUsageFromCloud(
    'fb_alice999',
    {
      windowStartedAtMs: t0.getTime(),
      windowMessagesUsed: 18,
    },
    t1
  );

  assert.equal(hydrated.usage.used, 18);
  assert.equal(hydrated.usage.limit, 20);
  assert.equal(hydrated.usage.remaining, 2);
  assert.equal(hydrated.usage.windowStartedAtMs, t0.getTime());

  // Attempting to hydrate a lower count (e.g., stale tab or tamper) cannot downgrade active usage
  const afterStaleHydrate = restartedStore.hydrateUsageFromCloud(
    'fb_alice999',
    {
      windowStartedAtMs: t0.getTime(),
      windowMessagesUsed: 2,
    },
    t1
  );
  assert.equal(afterStaleHydrate.usage.used, 18);

  // Sending 2 more messages reaches 20/20 limit and blocks #21
  restartedStore.recordMessageUsage('fb_alice999', t1);
  restartedStore.recordMessageUsage('fb_alice999', t1);
  const blocked = restartedStore.checkMessageAllowance('fb_alice999', 'standard', t1);
  assert.equal(blocked.allowed, false);
});

test('UserStore unlocks IND HYPER CODING MODEL and unlimited quota when plan is plus', () => {
  const store = new UserStore();
  store.setUserPlanInternal('u_plus', 'plus');

  const check = store.checkMessageAllowance('u_plus', 'hyper');
  assert.equal(check.allowed, true);

  const summary = store.getAccountSummary('u_plus');
  assert.equal(summary.plan, 'plus');
  assert.equal(summary.usage.limit, null);
});
