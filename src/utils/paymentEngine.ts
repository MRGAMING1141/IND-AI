import type { UserPlan } from '../types/agent';

export const OWNER_ADMIN_EMAIL = 'ffonlypro@gmail.com';
export const PLUS_PRICE_INR = 200;
export const PLUS_DURATION_DAYS = 30;
export const PLUS_DURATION_MS = PLUS_DURATION_DAYS * 24 * 60 * 60 * 1000;

const UPI_ID_REGEX = /^[a-zA-Z0-9._-]{2,64}@[a-zA-Z0-9]{2,32}$/;
const UTR_REGEX = /^[a-zA-Z0-9]{10,24}$/;

export function isAdminEmail(email?: string | null): boolean {
  if (typeof email !== 'string') return false;
  return email.trim().toLowerCase() === OWNER_ADMIN_EMAIL;
}

export function isValidUpiId(upiId: string): boolean {
  if (typeof upiId !== 'string') return false;
  const trimmed = upiId.trim();
  return UPI_ID_REGEX.test(trimmed);
}

export function normalizeUpiId(upiId: string): string {
  return upiId.trim().toLowerCase();
}

export function isValidPayeeName(payeeName: string): boolean {
  if (typeof payeeName !== 'string') return false;
  const trimmed = payeeName.trim();
  if (trimmed.length < 2 || trimmed.length > 60) return false;
  // Disallow control characters
  return !/[\u0000-\u001F\u007F]/.test(trimmed);
}

export function normalizeUtr(utr: string): string {
  return utr.replace(/\s+/g, '').trim().toUpperCase();
}

export function isValidUtr(utr: string): boolean {
  if (typeof utr !== 'string') return false;
  return UTR_REGEX.test(normalizeUtr(utr));
}

export function buildUpiPaymentUri(params: {
  upiId: string;
  payeeName: string;
  amountInr: number;
  note: string;
}): string {
  const cleanUpi = normalizeUpiId(params.upiId);
  if (!isValidUpiId(cleanUpi)) {
    throw new Error('Invalid UPI ID format. Example: yourname@fam');
  }

  const cleanPayee = params.payeeName.trim().slice(0, 60) || 'IND AGENT';
  const safeAmount = Math.max(1, Math.round(params.amountInr));
  const cleanNote = params.note
    .replace(/[^a-zA-Z0-9 ._-]/g, '')
    .trim()
    .slice(0, 60) || 'IND AGENT Plus';

  const query = new URLSearchParams({
    pa: cleanUpi,
    pn: cleanPayee,
    am: String(safeAmount),
    cu: 'INR',
    tn: cleanNote,
  });

  return `upi://pay?${query.toString()}`;
}

export function isPlusSubscriptionActive(
  plan: UserPlan,
  planExpiresAtMs?: number | null,
  nowMs: number = Date.now()
): boolean {
  if (plan !== 'plus') return false;
  if (typeof planExpiresAtMs !== 'number' || !Number.isFinite(planExpiresAtMs) || planExpiresAtMs <= 0) {
    return true;
  }
  return nowMs < planExpiresAtMs;
}

export function computeNewPlanExpiryMs(
  currentExpiresAtMs?: number | null,
  nowMs: number = Date.now()
): number {
  const base =
    typeof currentExpiresAtMs === 'number' &&
    Number.isFinite(currentExpiresAtMs) &&
    currentExpiresAtMs > nowMs
      ? Math.floor(currentExpiresAtMs)
      : Math.floor(nowMs);
  return base + PLUS_DURATION_MS;
}

export function formatExpiryDate(expiresAtMs?: number | null): string | null {
  if (typeof expiresAtMs !== 'number' || !Number.isFinite(expiresAtMs) || expiresAtMs <= 0) {
    return null;
  }
  try {
    return new Date(expiresAtMs).toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return null;
  }
}
