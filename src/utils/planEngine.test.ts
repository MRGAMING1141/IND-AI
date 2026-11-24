import assert from 'node:assert/strict';
import test from 'node:test';
import {
  GUEST_WINDOW_MESSAGE_LIMIT,
  PLAN_SPECS,
  SIGNED_IN_WINDOW_MESSAGE_LIMIT,
  USAGE_WINDOW_HOURS,
  USAGE_WINDOW_MS,
  canUseModel,
  checkWindowQuota,
  evaluateUsageWindow,
  formatResetCountdown,
  getContextLimit,
} from './planEngine.ts';

test('Free plan enforces 10-msg guest and 20-msg signed-in 5-hour limits and locks Hyper model', () => {
  assert.equal(USAGE_WINDOW_HOURS, 5);
  assert.equal(GUEST_WINDOW_MESSAGE_LIMIT, 10);
  assert.equal(SIGNED_IN_WINDOW_MESSAGE_LIMIT, 20);
  assert.equal(canUseModel('free', 'standard'), true);
  assert.equal(canUseModel('free', 'hyper'), false);

  const guestUnder = checkWindowQuota('free', GUEST_WINDOW_MESSAGE_LIMIT - 1, 'guest');
  assert.equal(guestUnder.allowed, true);
  assert.equal(guestUnder.limit, 10);
  assert.equal(guestUnder.remaining, 1);

  const guestAtLimit = checkWindowQuota('free', GUEST_WINDOW_MESSAGE_LIMIT, 'guest');
  assert.equal(guestAtLimit.allowed, false);
  assert.equal(guestAtLimit.remaining, 0);

  const signedInUnder = checkWindowQuota('free', SIGNED_IN_WINDOW_MESSAGE_LIMIT - 1, 'google');
  assert.equal(signedInUnder.allowed, true);
  assert.equal(signedInUnder.limit, 20);
  assert.equal(signedInUnder.remaining, 1);

  const signedInAtLimit = checkWindowQuota('free', SIGNED_IN_WINDOW_MESSAGE_LIMIT, 'google');
  assert.equal(signedInAtLimit.allowed, false);
  assert.equal(signedInAtLimit.remaining, 0);
});

test('Plus plan unlocks IND HYPER CODING MODEL, 100-msg context, ₹200/month pricing, and unlimited quota', () => {
  assert.equal(canUseModel('plus', 'standard'), true);
  assert.equal(canUseModel('plus', 'hyper'), true);
  assert.equal(getContextLimit('free'), 40);
  assert.equal(getContextLimit('plus'), 100);
  assert.ok(getContextLimit('plus') > getContextLimit('free'));
  assert.equal(PLAN_SPECS.plus.priceInrMonthly, 200);
  assert.equal(PLAN_SPECS.plus.priceDisplay, '₹200 / month');

  const quota = checkWindowQuota('plus', 500);
  assert.equal(quota.allowed, true);
  assert.equal(quota.limit, null);
  assert.equal(quota.remaining, null);
  assert.equal(PLAN_SPECS.plus.allowsMultiFileZip, true);
});

test('evaluateUsageWindow keeps active usage inside 5 hours and resets automatically after 5 hours', () => {
  const startMs = Date.parse('2026-11-22T10:00:00.000Z');
  const activeMs = startMs + 4 * 60 * 60 * 1000 + 30 * 60 * 1000; // +4h30m
  const active = evaluateUsageWindow(startMs, 14, activeMs);
  assert.equal(active.expired, false);
  assert.equal(active.used, 14);
  assert.equal(active.windowStartedAtMs, startMs);
  assert.equal(active.resetsAt, new Date(startMs + USAGE_WINDOW_MS).toISOString());

  const expiredMs = startMs + USAGE_WINDOW_MS; // exact 5h mark
  const expired = evaluateUsageWindow(startMs, 14, expiredMs);
  assert.equal(expired.expired, true);
  assert.equal(expired.used, 0);
  assert.equal(expired.windowStartedAtMs, 0);
  assert.equal(expired.resetsAt, null);
});

test('formatResetCountdown formats remaining hours and minutes cleanly', () => {
  const nowMs = Date.parse('2026-11-22T10:00:00.000Z');
  assert.equal(
    formatResetCountdown('2026-11-22T14:45:00.000Z', nowMs),
    '4h 45m'
  );
  assert.equal(
    formatResetCountdown('2026-11-22T10:25:00.000Z', nowMs),
    '25m'
  );
  assert.equal(
    formatResetCountdown('2026-11-22T09:59:00.000Z', nowMs),
    'Resetting now'
  );
  assert.equal(formatResetCountdown(null, nowMs), null);
});
