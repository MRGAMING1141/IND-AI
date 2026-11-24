import assert from 'node:assert/strict';
import test from 'node:test';
import {
  OWNER_ADMIN_EMAIL,
  PLUS_DURATION_MS,
  PLUS_PRICE_INR,
  buildUpiPaymentUri,
  computeNewPlanExpiryMs,
  isAdminEmail,
  isPlusSubscriptionActive,
  isValidPayeeName,
  isValidUpiId,
  isValidUtr,
  normalizeUtr,
} from './paymentEngine.ts';

test('FamPay and standard Indian UPI ID validation accepts valid handles and rejects unsafe strings', () => {
  assert.equal(isValidUpiId('myaccount@fam'), true);
  assert.equal(isValidUpiId('ind.agent_01@fampay'), true);
  assert.equal(isValidUpiId('owner-1@okaxis'), true);

  assert.equal(isValidUpiId(''), false);
  assert.equal(isValidUpiId('not-a-upi-id'), false);
  assert.equal(isValidUpiId('javascript:alert(1)@fam'), false);
  assert.equal(isValidUpiId('a@b'), false);
  assert.equal(isValidUpiId('user@fam?am=1'), false);
});

test('UTR validation accepts 12-digit numeric and bank alphanumeric UTRs and rejects short/malformed values', () => {
  assert.equal(isValidUtr('432719845612'), true);
  assert.equal(isValidUtr(' 4327 1984 5612 '), true);
  assert.equal(normalizeUtr(' 4327 1984 5612 '), '432719845612');
  assert.equal(isValidUtr('FAM202611229988'), true);

  assert.equal(isValidUtr('12345'), false);
  assert.equal(isValidUtr('4327-1984-5612!'), false);
  assert.equal(isValidUtr(''), false);
});

test('buildUpiPaymentUri encodes ₹200 FamPay deep link cleanly and enforces upi:// scheme', () => {
  const uri = buildUpiPaymentUri({
    upiId: 'MyShop@FAM',
    payeeName: 'IND AGENT Plus',
    amountInr: PLUS_PRICE_INR,
    note: 'INDAGENT-PLUS-abc123',
  });
  assert.ok(uri.startsWith('upi://pay?'));
  const parsed = new URL(uri);
  assert.equal(parsed.protocol, 'upi:');
  assert.equal(parsed.searchParams.get('pa'), 'myshop@fam');
  assert.equal(parsed.searchParams.get('pn'), 'IND AGENT Plus');
  assert.equal(parsed.searchParams.get('am'), '200');
  assert.equal(parsed.searchParams.get('cu'), 'INR');
  assert.equal(parsed.searchParams.get('tn'), 'INDAGENT-PLUS-abc123');

  assert.throws(() =>
    buildUpiPaymentUri({
      upiId: 'javascript:alert(1)',
      payeeName: 'Bad',
      amountInr: 200,
      note: 'test',
    })
  );
});

test('Plus subscription expiry & renewal math and admin email check work accurately', () => {
  const now = Date.parse('2026-11-22T12:00:00.000Z');
  assert.equal(PLUS_PRICE_INR, 200);
  assert.equal(isAdminEmail(OWNER_ADMIN_EMAIL), true);
  assert.equal(isAdminEmail('  FFONLYPRO@GMAIL.COM  '), true);
  assert.equal(isAdminEmail('random@gmail.com'), false);
  assert.equal(isAdminEmail(null), false);

  assert.equal(isPlusSubscriptionActive('free', now + 10000, now), false);
  assert.equal(isPlusSubscriptionActive('plus', now + 10000, now), true);
  assert.equal(isPlusSubscriptionActive('plus', now - 1000, now), false);
  assert.equal(isPlusSubscriptionActive('plus', 0, now), true);

  const firstExpiry = computeNewPlanExpiryMs(0, now);
  assert.equal(firstExpiry, now + PLUS_DURATION_MS);

  const extendedExpiry = computeNewPlanExpiryMs(firstExpiry, now + 5_000);
  assert.equal(extendedExpiry, firstExpiry + PLUS_DURATION_MS);

  assert.equal(isValidPayeeName('IND AGENT'), true);
  assert.equal(isValidPayeeName('A'), false);
});
