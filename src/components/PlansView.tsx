import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  Check,
  CheckCircle2,
  Clock,
  Cloud,
  Copy,
  Cpu,
  Database,
  LogIn,
  QrCode,
  ShieldCheck,
  Sparkles,
  XCircle,
} from 'lucide-react';
import {
  GUEST_WINDOW_MESSAGE_LIMIT,
  HYPER_CONTEXT_MESSAGE_LIMIT,
  PLAN_SPECS,
  SIGNED_IN_WINDOW_MESSAGE_LIMIT,
  STANDARD_CONTEXT_MESSAGE_LIMIT,
  USAGE_WINDOW_HOURS,
  formatResetCountdown,
} from '../utils/planEngine';
import {
  PLUS_DURATION_DAYS,
  PLUS_PRICE_INR,
  formatExpiryDate,
  isValidPayeeName,
  isValidUpiId,
} from '../utils/paymentEngine';
import { UpiPaymentModal } from './UpiPaymentModal';
import type {
  BillingSettings,
  PaymentRequestRecord,
  UserAccountSummary,
} from '../types/agent';

interface PlansViewProps {
  account: UserAccountSummary;
  authUser: { uid: string; displayName: string; email: string } | null;
  isOwner: boolean;
  billingSettings: BillingSettings | null;
  userPaymentRequests: PaymentRequestRecord[];
  allPaymentRequests: PaymentRequestRecord[];
  onGoToCommand: () => void;
  onSignInGoogle?: () => Promise<void>;
  onSubmitPayment: (input: { utr: string; payerUpi?: string }) => Promise<void>;
  onSaveBillingSettings: (upiId: string, payeeName: string) => Promise<void>;
  onReviewPayment: (
    request: PaymentRequestRecord,
    decision: 'approved' | 'rejected',
    adminNote?: string
  ) => Promise<void>;
  onToggleOwnerPlan?: (nextPlan: 'free' | 'plus') => Promise<void>;
  authBusy?: boolean;
}

const COMPARISON_ROWS: Array<{
  feature: string;
  free: string;
  plus: string;
}> = [
  {
    feature: 'Coding Model',
    free: 'Standard Coding Model (Fast & High-Level)',
    plus: 'Standard + IND HYPER CODING MODEL',
  },
  {
    feature: '5-Hour Message Limit',
    free: `${GUEST_WINDOW_MESSAGE_LIMIT} / ${USAGE_WINDOW_HOURS} hrs (Free Guest) · ${SIGNED_IN_WINDOW_MESSAGE_LIMIT} / ${USAGE_WINDOW_HOURS} hrs (Signed In)`,
    plus: 'Unlimited',
  },
  {
    feature: 'Context Length',
    free: `Expanded (${STANDARD_CONTEXT_MESSAGE_LIMIT} messages)`,
    plus: `Ultra-long (${HYPER_CONTEXT_MESSAGE_LIMIT} messages)`,
  },
  {
    feature: 'Monthly Price',
    free: '₹0 / month',
    plus: `₹${PLUS_PRICE_INR} / month (FamPay / UPI)`,
  },
  {
    feature: 'Usage & Chat Persistence',
    free: 'Saved in Firebase Firestore when signed in (survives restarts)',
    plus: 'Firebase Firestore + priority sync',
  },
  {
    feature: 'Reset Schedule',
    free: `Automatic rolling reset every ${USAGE_WINDOW_HOURS} hours`,
    plus: 'No usage cap',
  },
  {
    feature: 'Code Generation Output',
    free: 'Single-file & full-stack preview',
    plus: 'Multi-file project generation + ZIP download',
  },
  {
    feature: 'Bug Self-Review Pass',
    free: 'Auto-debug & verification loop',
    plus: 'Step-by-step planning + automatic self-review pass',
  },
  {
    feature: 'Connected Integrations',
    free: 'Gmail + Google Drive (drive.file)',
    plus: 'Gmail + Google Drive (drive.file)',
  },
];

export function PlansView({
  account,
  authUser,
  isOwner,
  billingSettings,
  userPaymentRequests,
  allPaymentRequests,
  onGoToCommand,
  onSignInGoogle,
  onSubmitPayment,
  onSaveBillingSettings,
  onReviewPayment,
  onToggleOwnerPlan,
  authBusy = false,
}: PlansViewProps) {
  const [paymentModalOpen, setPaymentModalOpen] = useState(false);
  const [togglingOwnerPlan, setTogglingOwnerPlan] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());

  // Owner FamPay Billing Config form state
  const [upiInput, setUpiInput] = useState(billingSettings?.upiId ?? '');
  const [payeeInput, setPayeeInput] = useState(billingSettings?.payeeName ?? 'IND AGENT');
  const [savingBilling, setSavingBilling] = useState(false);
  const [billingFeedback, setBillingFeedback] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  // Owner Payment Review state
  const [reviewingId, setReviewingId] = useState<string | null>(null);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [copiedUtrId, setCopiedUtrId] = useState<string | null>(null);
  const ownerSectionRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (billingSettings?.upiId) {
      setUpiInput(billingSettings.upiId);
    }
    if (billingSettings?.payeeName) {
      setPayeeInput(billingSettings.payeeName);
    }
  }, [billingSettings?.upiId, billingSettings?.payeeName]);

  const isPlus = account?.plan === 'plus';
  const isGuest = !authUser || account?.authType === 'guest';
  const used = account?.usage?.used ?? 0;
  const fallbackLimit = isGuest ? GUEST_WINDOW_MESSAGE_LIMIT : SIGNED_IN_WINDOW_MESSAGE_LIMIT;
  const limit = isPlus ? null : (account?.usage?.limit ?? fallbackLimit);
  const remaining = limit === null ? null : Math.max(0, limit - used);
  const usagePercent = limit ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  const resetCountdown = formatResetCountdown(account?.usage?.resetsAt, nowMs);
  const localResetTime = account?.usage?.resetsAt
    ? new Date(account.usage.resetsAt).toLocaleTimeString([], {
        hour: 'numeric',
        minute: '2-digit',
      })
    : null;
  const expiryLabel = formatExpiryDate(account?.planExpiresAt);

  const pendingOwnerCount = allPaymentRequests.filter((r) => r.status === 'pending').length;

  const handleUpgradeClick = () => {
    if (isGuest) {
      if (onSignInGoogle) {
        void onSignInGoogle();
      }
      return;
    }
    setPaymentModalOpen(true);
  };

  const handleSaveBilling = async (e: FormEvent) => {
    e.preventDefault();
    setBillingFeedback(null);
    if (!isValidUpiId(upiInput)) {
      setBillingFeedback({
        type: 'error',
        text: 'Enter a valid FamPay or UPI ID (example: yourname@fam).',
      });
      return;
    }
    if (!isValidPayeeName(payeeInput)) {
      setBillingFeedback({
        type: 'error',
        text: 'Payee display name must be 2–60 characters.',
      });
      return;
    }
    setSavingBilling(true);
    try {
      await onSaveBillingSettings(upiInput, payeeInput);
      setBillingFeedback({
        type: 'success',
        text: 'FamPay UPI checkout details saved! Customers can now scan and pay ₹200 directly.',
      });
    } catch (err) {
      setBillingFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'Could not save FamPay UPI settings.',
      });
    } finally {
      setSavingBilling(false);
    }
  };

  const handleReview = async (
    request: PaymentRequestRecord,
    decision: 'approved' | 'rejected'
  ) => {
    setReviewError(null);
    setReviewingId(request.id);
    try {
      await onReviewPayment(request, decision);
    } catch (err) {
      setReviewError(err instanceof Error ? err.message : 'Could not update payment status.');
    } finally {
      setReviewingId(null);
    }
  };

  const handleCopyUtr = async (id: string, utr: string) => {
    try {
      await navigator.clipboard.writeText(utr);
      setCopiedUtrId(id);
      window.setTimeout(() => setCopiedUtrId(null), 1600);
    } catch {
      // Ignore clipboard error
    }
  };

  return (
    <div className="h-full overflow-y-auto px-5 py-6 bg-white dark:bg-[#131314]">
      <div className="mx-auto max-w-5xl space-y-8">
        <div className="flex flex-wrap items-end justify-between gap-4 border-b border-[#E1E5EA] dark:border-[#2E3033] pb-5">
          <div>
            <h1 className="font-display text-2xl font-medium text-[#1F1F1F] dark:text-[#E3E3E3]">
              Plans &amp; Usage
            </h1>
            <p className="mt-1 text-sm text-[#5F6368] dark:text-[#9AA0A6]">
              Rolling {USAGE_WINDOW_HOURS}-hour usage limit ({GUEST_WINDOW_MESSAGE_LIMIT} Guest /{' '}
              {SIGNED_IN_WINDOW_MESSAGE_LIMIT} Signed In) · Upgrade to IND HYPER for ₹{PLUS_PRICE_INR}/month via FamPay / UPI.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {isGuest && onSignInGoogle && (
              <button
                type="button"
                disabled={authBusy}
                onClick={() => void onSignInGoogle()}
                className="inline-flex items-center gap-1.5 rounded-full bg-[#1A73E8] px-4 py-2 text-xs font-medium text-white hover:bg-[#1557B0] disabled:opacity-50 transition-colors whitespace-nowrap shrink-0"
              >
                <LogIn className="h-3.5 w-3.5" aria-hidden="true" />
                <span>{authBusy ? 'Signing in...' : `Sign in for ${SIGNED_IN_WINDOW_MESSAGE_LIMIT} / 5h`}</span>
              </button>
            )}
            <button
              type="button"
              onClick={onGoToCommand}
              className="rounded-full border border-[#DDE3EA] dark:border-[#3C4043] bg-white dark:bg-[#1E1F20] px-4 py-2 text-xs font-medium text-[#444746] dark:text-[#E3E3E3] hover:bg-[#F0F4F9] dark:hover:bg-[#282A2C] transition-colors whitespace-nowrap shrink-0"
            >
              Back to Chats
            </button>
          </div>
        </div>

        {/* 5-Hour Rolling Usage Window Summary */}
        <section
          aria-label="5-hour rolling usage window"
          className="rounded-2xl border border-[#E1E5EA] dark:border-[#333537] bg-[#F8FAFD] dark:bg-[#1E1F20] p-6 space-y-5"
        >
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="text-xs font-medium text-[#5F6368] dark:text-[#9AA0A6]">
                Current Workspace Plan
              </div>
              <div className="flex flex-wrap items-center gap-2.5">
                <span className="text-lg font-semibold text-[#1F1F1F] dark:text-[#E3E3E3]">
                  {isPlus ? 'IND AGENT Plus' : isGuest ? 'Free Guest' : 'Signed-In Plan'}
                </span>
                <span className="text-xs font-mono text-[#5F6368] dark:text-[#9AA0A6]">
                  ·{' '}
                  {isPlus
                    ? expiryLabel
                      ? `Active until ${expiryLabel}`
                      : 'Active Plus Pass'
                    : isGuest
                      ? `${GUEST_WINDOW_MESSAGE_LIMIT} msgs / ${USAGE_WINDOW_HOURS} hrs · Sign in for ${SIGNED_IN_WINDOW_MESSAGE_LIMIT} / ${USAGE_WINDOW_HOURS} hrs`
                      : `${account.email || account.displayName} · Saved in Firebase`}
                </span>
              </div>
            </div>

            {!isPlus ? (
              <div className="min-w-[240px] space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-[#5F6368] dark:text-[#9AA0A6]">
                    {USAGE_WINDOW_HOURS}-Hour Usage Window
                  </span>
                  <span className="font-mono font-semibold tabular-nums text-[#1F1F1F] dark:text-[#E3E3E3]">
                    {used} / {limit} messages
                  </span>
                </div>
                <div className="h-2.5 w-full overflow-hidden rounded-full bg-[#DDE3EA] dark:bg-[#333537]">
                  <div
                    className={`h-full rounded-full transition-all duration-300 ${
                      usagePercent >= 90
                        ? 'bg-[#D93025]'
                        : usagePercent >= 75
                          ? 'bg-[#F9AB00]'
                          : 'bg-[#1A73E8] dark:bg-[#8AB4F8]'
                    }`}
                    style={{ width: `${usagePercent}%` }}
                  />
                </div>
                <div className="flex items-center justify-between text-[11px] text-[#5F6368] dark:text-[#9AA0A6]">
                  <span>
                    {resetCountdown
                      ? `Resets in ${resetCountdown}${localResetTime ? ` (${localResetTime})` : ''}`
                      : `Starts on your next message · resets every ${USAGE_WINDOW_HOURS} hours`}
                  </span>
                </div>
              </div>
            ) : (
              <div className="text-xs font-medium text-[#188038] dark:text-[#81C995]">
                Unlimited messages · IND HYPER CODING MODEL unlocked
              </div>
            )}
          </div>

          {/* 3-Column Live Window Metrics + Firebase Persistence Status */}
          <div className="grid grid-cols-1 gap-3 border-t border-[#E1E5EA] dark:border-[#2E3033] pt-5 sm:grid-cols-3">
            <div className="rounded-xl border border-[#E1E5EA] dark:border-[#2E3033] bg-white dark:bg-[#131314] px-4 py-3">
              <div className="flex items-center gap-1.5 text-xs text-[#5F6368] dark:text-[#9AA0A6]">
                <Clock className="h-3.5 w-3.5 text-[#1A73E8] dark:text-[#8AB4F8]" aria-hidden="true" />
                <span>Window Quota</span>
              </div>
              <div className="mt-1 font-mono text-lg font-semibold tabular-nums text-[#1F1F1F] dark:text-[#E3E3E3]">
                {isPlus ? 'Unlimited' : `${used} / ${limit}`}
              </div>
              <div className="mt-0.5 text-[11px] text-[#5F6368] dark:text-[#9AA0A6]">
                {isPlus
                  ? 'No 5-hour message cap'
                  : `${remaining} remaining in this ${USAGE_WINDOW_HOURS}-hour window`}
              </div>
            </div>

            <div className="rounded-xl border border-[#E1E5EA] dark:border-[#2E3033] bg-white dark:bg-[#131314] px-4 py-3">
              <div className="flex items-center gap-1.5 text-xs text-[#5F6368] dark:text-[#9AA0A6]">
                <Clock className="h-3.5 w-3.5 text-[#1A73E8] dark:text-[#8AB4F8]" aria-hidden="true" />
                <span>Context Window</span>
              </div>
              <div className="mt-1 font-mono text-lg font-semibold tabular-nums text-[#1F1F1F] dark:text-[#E3E3E3]">
                {isPlus ? `${HYPER_CONTEXT_MESSAGE_LIMIT} msgs` : `${STANDARD_CONTEXT_MESSAGE_LIMIT} msgs`}
              </div>
              <div className="mt-0.5 text-[11px] text-[#5F6368] dark:text-[#9AA0A6]">
                {isPlus
                  ? 'Ultra-long IND HYPER session context'
                  : `Standard expanded context · ${HYPER_CONTEXT_MESSAGE_LIMIT} msgs on Plus`}
              </div>
            </div>

            <div className="rounded-xl border border-[#E1E5EA] dark:border-[#2E3033] bg-white dark:bg-[#131314] px-4 py-3">
              <div className="flex items-center gap-1.5 text-xs text-[#5F6368] dark:text-[#9AA0A6]">
                <Database className="h-3.5 w-3.5 text-[#188038] dark:text-[#81C995]" aria-hidden="true" />
                <span>Usage Storage</span>
              </div>
              <div className="mt-1 text-sm font-semibold text-[#1F1F1F] dark:text-[#E3E3E3]">
                {isGuest ? 'Guest Session' : 'Firebase Firestore'}
              </div>
              <div className="mt-0.5 text-[11px] text-[#5F6368] dark:text-[#9AA0A6]">
                {isGuest
                  ? `Sign in to save usage & unlock ${SIGNED_IN_WINDOW_MESSAGE_LIMIT} msgs / ${USAGE_WINDOW_HOURS}h`
                  : 'Persisted in cloud — survives app restarts'}
              </div>
            </div>
          </div>
        </section>

        {/* Plan Cards */}
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          {/* Free Plan */}
          <article className="flex flex-col justify-between rounded-2xl border border-[#E1E5EA] dark:border-[#333537] bg-white dark:bg-[#1E1F20] p-6 space-y-6">
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-lg font-semibold text-[#1F1F1F] dark:text-[#E3E3E3]">
                  {PLAN_SPECS.free.name}
                </h2>
                {!isPlus && (
                  <span className="text-xs font-semibold text-[#188038] dark:text-[#81C995]">
                    Current Plan
                  </span>
                )}
              </div>
              <div>
                <div className="font-mono text-2xl font-bold tabular-nums text-[#1F1F1F] dark:text-[#E3E3E3]">
                  {PLAN_SPECS.free.priceDisplay}
                </div>
                <p className="mt-1.5 text-sm text-[#5F6368] dark:text-[#9AA0A6]">
                  {PLAN_SPECS.free.tagline}
                </p>
              </div>

              <ul className="space-y-2.5 border-t border-[#E1E5EA] dark:border-[#2E3033] pt-4 text-sm text-[#444746] dark:text-[#C4C7C5]">
                {PLAN_SPECS.free.features.map((item) => (
                  <li key={item} className="flex items-start gap-2.5">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-[#188038] dark:text-[#81C995]" aria-hidden="true" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="pt-2">
              <button
                type="button"
                disabled
                className="w-full rounded-full border border-[#DDE3EA] dark:border-[#3C4043] bg-[#F0F4F9] dark:bg-[#282A2C] px-4 py-2.5 text-xs font-semibold text-[#5F6368] dark:text-[#9AA0A6] cursor-default"
              >
                {!isPlus ? 'Active on This Session' : 'Standard Tier'}
              </button>
            </div>
          </article>

          {/* IND AGENT Plus (₹200 / month via FamPay / UPI) */}
          <article className="flex flex-col justify-between rounded-2xl border-2 border-[#1A73E8] dark:border-[#8AB4F8] bg-white dark:bg-[#1E1F20] p-6 space-y-6">
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-2">
                <h2 className="inline-flex items-center gap-2 text-lg font-semibold text-[#1F1F1F] dark:text-[#E3E3E3]">
                  <Sparkles className="h-4 w-4 text-[#1A73E8] dark:text-[#8AB4F8]" aria-hidden="true" />
                  {PLAN_SPECS.plus.name}
                </h2>
                <span className="text-xs font-semibold text-[#1A73E8] dark:text-[#8AB4F8]">
                  {isPlus ? 'Active Plan' : 'FamPay / UPI'}
                </span>
              </div>

              <div>
                <div className="flex items-baseline gap-2">
                  <span className="font-mono text-2xl font-bold tabular-nums text-[#1F1F1F] dark:text-[#E3E3E3]">
                    {PLAN_SPECS.plus.priceDisplay}
                  </span>
                  <span className="text-xs text-[#5F6368] dark:text-[#9AA0A6]">
                    {PLUS_DURATION_DAYS}-day pass
                  </span>
                </div>
                {PLAN_SPECS.plus.yearlyPlaceholder && (
                  <div className="mt-0.5 font-mono text-xs text-[#5F6368] dark:text-[#9AA0A6]">
                    or {PLAN_SPECS.plus.yearlyPlaceholder}
                  </div>
                )}
                <p className="mt-2 text-sm text-[#5F6368] dark:text-[#9AA0A6]">
                  {PLAN_SPECS.plus.tagline}
                </p>
              </div>

              <ul className="space-y-2.5 border-t border-[#E1E5EA] dark:border-[#2E3033] pt-4 text-sm text-[#444746] dark:text-[#C4C7C5]">
                {PLAN_SPECS.plus.features.map((item) => (
                  <li key={item} className="flex items-start gap-2.5">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-[#1A73E8] dark:text-[#8AB4F8]" aria-hidden="true" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="space-y-2.5 pt-2">
              <button
                type="button"
                disabled={authBusy}
                onClick={handleUpgradeClick}
                className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-[#1A73E8] dark:bg-[#8AB4F8] px-4 py-2.5 text-xs font-semibold text-white dark:text-[#041E49] hover:bg-[#1557B0] dark:hover:bg-[#A8C7FA] disabled:opacity-50 transition-colors"
              >
                {isGuest ? (
                  <>
                    <LogIn className="h-3.5 w-3.5" />
                    <span>Sign in with Google to Upgrade (₹{PLUS_PRICE_INR}/mo)</span>
                  </>
                ) : isPlus ? (
                  <>
                    <QrCode className="h-3.5 w-3.5" />
                    <span>Extend Plus +30 Days (₹{PLUS_PRICE_INR} UPI)</span>
                  </>
                ) : (
                  <>
                    <QrCode className="h-3.5 w-3.5" />
                    <span>Pay ₹{PLUS_PRICE_INR} via FamPay / UPI</span>
                  </>
                )}
              </button>
              <p className="text-center text-[11px] text-[#5F6368] dark:text-[#9AA0A6]">
                Scan QR or pay via FamApp, GPay, PhonePe, or Paytm · Submit 12-digit UTR to activate
              </p>
            </div>
          </article>
        </div>

        {/* User's Recent Payment Verification Requests */}
        {!isGuest && userPaymentRequests.length > 0 && (
          <section className="rounded-2xl border border-[#E1E5EA] dark:border-[#333537] bg-[#F8FAFD] dark:bg-[#1E1F20] p-5 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-[#1F1F1F] dark:text-[#E3E3E3]">
                Your UPI Payment Requests
              </h2>
              <span className="text-xs text-[#5F6368] dark:text-[#9AA0A6]">
                {userPaymentRequests.length} submitted
              </span>
            </div>
            <div className="divide-y divide-[#E1E5EA] dark:divide-[#2E3033] rounded-xl border border-[#E1E5EA] dark:border-[#2E3033] bg-white dark:bg-[#131314]">
              {userPaymentRequests.map((req) => (
                <div
                  key={req.id}
                  className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-xs"
                >
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-2 font-medium text-[#1F1F1F] dark:text-[#E3E3E3]">
                      <span>IND AGENT Plus · ₹{req.amountInr}</span>
                      <code className="rounded bg-[#F0F4F9] dark:bg-[#282A2C] px-1.5 py-0.5 font-mono text-[11px]">
                        UTR: {req.utr}
                      </code>
                    </div>
                    <div className="text-[11px] text-[#5F6368] dark:text-[#9AA0A6]">
                      Submitted {new Date(req.createdAt).toLocaleString()}
                      {req.adminNote ? ` · ${req.adminNote}` : ''}
                    </div>
                  </div>
                  <div className="font-semibold">
                    {req.status === 'approved' ? (
                      <span className="inline-flex items-center gap-1 text-[#188038] dark:text-[#81C995]">
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        Approved · Plus Active
                      </span>
                    ) : req.status === 'rejected' ? (
                      <span className="inline-flex items-center gap-1 text-[#D93025] dark:text-[#F6AEA9]">
                        <XCircle className="h-3.5 w-3.5" />
                        Rejected
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-[#B06000] dark:text-[#FDD663]">
                        <Clock className="h-3.5 w-3.5" />
                        Pending Verification
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Owner-Only FamPay Billing Setup & Payment Verification Dashboard */}
        {isOwner && (
          <section
            ref={ownerSectionRef}
            aria-label="Owner FamPay Billing and Payment Verification"
            className="rounded-2xl border-2 border-[#1A73E8]/35 dark:border-[#8AB4F8]/35 bg-[#F8FAFD] dark:bg-[#1E1F20] p-6 space-y-6"
          >
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[#E1E5EA] dark:border-[#2E3033] pb-4">
              <div className="space-y-1">
                <div className="flex items-center gap-2 text-sm font-semibold text-[#1F1F1F] dark:text-[#E3E3E3]">
                  <ShieldCheck className="h-4 w-4 text-[#1A73E8] dark:text-[#8AB4F8]" />
                  <span>Owner FamPay UPI Billing &amp; Verification</span>
                </div>
                <p className="text-xs text-[#5F6368] dark:text-[#9AA0A6]">
                  Only visible to you ({authUser?.email}). IND AGENT Plus (IND HYPER CODING MODEL) is
                  unlocked on your owner account for testing.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {onToggleOwnerPlan && (
                  <button
                    type="button"
                    disabled={togglingOwnerPlan}
                    onClick={() => {
                      setTogglingOwnerPlan(true);
                      void onToggleOwnerPlan(isPlus ? 'free' : 'plus').finally(() =>
                        setTogglingOwnerPlan(false)
                      );
                    }}
                    className="rounded-full border border-[#DDE3EA] dark:border-[#3C4043] bg-white dark:bg-[#131314] px-3.5 py-1.5 text-xs font-medium text-[#1F1F1F] dark:text-[#E3E3E3] hover:bg-[#F0F4F9] dark:hover:bg-[#282A2C] disabled:opacity-50 transition-colors"
                  >
                    {togglingOwnerPlan
                      ? 'Switching...'
                      : isPlus
                        ? 'Owner Mode: Plus Active (Test Free)'
                        : 'Activate Owner IND HYPER (Plus)'}
                  </button>
                )}
                {pendingOwnerCount > 0 && (
                  <span className="rounded-full bg-[#1A73E8] px-3 py-1 text-xs font-semibold text-white">
                    {pendingOwnerCount} pending verification
                  </span>
                )}
              </div>
            </div>

            {/* FamPay UPI ID Form */}
            <form onSubmit={(e) => void handleSaveBilling(e)} className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div className="space-y-1.5">
                <label
                  htmlFor="owner-fampay-upi"
                  className="block text-xs font-medium text-[#1F1F1F] dark:text-[#E3E3E3]"
                >
                  Your FamPay UPI ID
                </label>
                <input
                  id="owner-fampay-upi"
                  type="text"
                  required
                  value={upiInput}
                  onChange={(e) => setUpiInput(e.target.value)}
                  placeholder="yourname@fam"
                  maxLength={98}
                  className="w-full rounded-xl border border-[#DDE3EA] dark:border-[#3C4043] bg-white dark:bg-[#131314] px-3.5 py-2 font-mono text-xs text-[#1F1F1F] dark:text-[#E3E3E3] placeholder:text-[#9AA0A6] focus:border-[#1A73E8] focus:outline-none"
                />
              </div>

              <div className="space-y-1.5">
                <label
                  htmlFor="owner-payee-name"
                  className="block text-xs font-medium text-[#1F1F1F] dark:text-[#E3E3E3]"
                >
                  Payee Display Name
                </label>
                <input
                  id="owner-payee-name"
                  type="text"
                  required
                  value={payeeInput}
                  onChange={(e) => setPayeeInput(e.target.value)}
                  placeholder="IND AGENT"
                  maxLength={60}
                  className="w-full rounded-xl border border-[#DDE3EA] dark:border-[#3C4043] bg-white dark:bg-[#131314] px-3.5 py-2 text-xs text-[#1F1F1F] dark:text-[#E3E3E3] placeholder:text-[#9AA0A6] focus:border-[#1A73E8] focus:outline-none"
                />
              </div>

              <div className="flex items-end">
                <button
                  type="submit"
                  disabled={savingBilling}
                  className="w-full rounded-full bg-[#1A73E8] dark:bg-[#8AB4F8] px-4 py-2 text-xs font-semibold text-white dark:text-[#041E49] hover:bg-[#1557B0] dark:hover:bg-[#A8C7FA] disabled:opacity-50 transition-colors"
                >
                  {savingBilling ? 'Saving...' : 'Save FamPay UPI ID'}
                </button>
              </div>
            </form>

            {billingFeedback && (
              <div
                role="status"
                className={`rounded-xl px-3.5 py-2 text-xs ${
                  billingFeedback.type === 'success'
                    ? 'border border-[#B7DFBF] bg-[#E6F4EA] text-[#137333] dark:border-[#1E4620] dark:bg-[#132A16] dark:text-[#A8DAB5]'
                    : 'border border-[#F5C2C0] bg-[#FCE8E6] text-[#A50E0E] dark:border-[#5F2120] dark:bg-[#3B1E1D] dark:text-[#F6AEA9]'
                }`}
              >
                {billingFeedback.text}
              </div>
            )}

            {/* Incoming UTR Verification Queue */}
            <div className="space-y-3">
              <div className="text-xs font-semibold text-[#1F1F1F] dark:text-[#E3E3E3]">
                Customer Payment Verification Queue ({allPaymentRequests.length})
              </div>

              {reviewError && (
                <div
                  role="alert"
                  className="rounded-xl border border-[#F5C2C0] bg-[#FCE8E6] dark:bg-[#3B1E1D] px-3.5 py-2 text-xs text-[#A50E0E] dark:text-[#F6AEA9]"
                >
                  {reviewError}
                </div>
              )}

              {allPaymentRequests.length === 0 ? (
                <div className="rounded-xl border border-dashed border-[#DDE3EA] dark:border-[#3C4043] bg-white dark:bg-[#131314] px-4 py-5 text-center text-xs text-[#5F6368] dark:text-[#9AA0A6]">
                  No UPI payment requests yet. When a user pays ₹{PLUS_PRICE_INR} to your FamPay UPI ID
                  and submits their 12-digit UTR, it will appear here for 1-click verification.
                </div>
              ) : (
                <div className="divide-y divide-[#E1E5EA] dark:divide-[#2E3033] rounded-xl border border-[#E1E5EA] dark:border-[#2E3033] bg-white dark:bg-[#131314]">
                  {allPaymentRequests.map((req) => (
                    <div
                      key={req.id}
                      className="flex flex-wrap items-center justify-between gap-3 px-4 py-3.5 text-xs"
                    >
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-semibold text-[#1F1F1F] dark:text-[#E3E3E3]">
                            {req.userName}
                          </span>
                          <span className="text-[#5F6368] dark:text-[#9AA0A6]">{req.userEmail}</span>
                          <span className="font-mono font-semibold text-[#188038] dark:text-[#81C995]">
                            ₹{req.amountInr}
                          </span>
                        </div>
                        <div className="flex flex-wrap items-center gap-2 text-[11px] text-[#5F6368] dark:text-[#9AA0A6]">
                          <code className="rounded bg-[#F0F4F9] dark:bg-[#282A2C] px-2 py-0.5 font-mono text-[#1F1F1F] dark:text-[#E3E3E3]">
                            UTR: {req.utr}
                          </code>
                          <button
                            type="button"
                            onClick={() => void handleCopyUtr(req.id, req.utr)}
                            className="inline-flex items-center gap-1 text-[#1A73E8] dark:text-[#8AB4F8] hover:underline"
                          >
                            {copiedUtrId === req.id ? (
                              <>
                                <Check className="h-3 w-3" />
                                Copied
                              </>
                            ) : (
                              <>
                                <Copy className="h-3 w-3" />
                                Copy UTR
                              </>
                            )}
                          </button>
                          {req.payerUpi && <span>· From: {req.payerUpi}</span>}
                          <span>· {new Date(req.createdAt).toLocaleString()}</span>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        {req.status === 'pending' ? (
                          <>
                            <button
                              type="button"
                              disabled={reviewingId === req.id}
                              onClick={() => void handleReview(req, 'approved')}
                              className="rounded-full bg-[#188038] px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-[#137333] disabled:opacity-50 transition-colors"
                            >
                              {reviewingId === req.id ? 'Activating...' : 'Verify & Activate Plus'}
                            </button>
                            <button
                              type="button"
                              disabled={reviewingId === req.id}
                              onClick={() => void handleReview(req, 'rejected')}
                              className="rounded-full border border-[#DDE3EA] dark:border-[#3C4043] px-3 py-1.5 text-xs font-medium text-[#D93025] dark:text-[#F6AEA9] hover:bg-[#FCE8E6] dark:hover:bg-[#3B1E1D] disabled:opacity-50 transition-colors"
                            >
                              Reject
                            </button>
                          </>
                        ) : req.status === 'approved' ? (
                          <span className="inline-flex items-center gap-1 font-semibold text-[#188038] dark:text-[#81C995]">
                            <CheckCircle2 className="h-3.5 w-3.5" />
                            Approved
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 font-semibold text-[#D93025] dark:text-[#F6AEA9]">
                            <XCircle className="h-3.5 w-3.5" />
                            Rejected
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>
        )}

        {/* IND HYPER CODING MODEL Highlight */}
        <section className="rounded-2xl border border-[#E1E5EA] dark:border-[#333537] bg-[#F8FAFD] dark:bg-[#1E1F20] p-5 space-y-3">
          <div className="flex items-center gap-2">
            <Cpu className="h-4 w-4 text-[#1A73E8] dark:text-[#8AB4F8]" aria-hidden="true" />
            <h2 className="text-sm font-semibold text-[#1F1F1F] dark:text-[#E3E3E3]">
              About IND HYPER CODING MODEL (Plus · ₹{PLUS_PRICE_INR}/month)
            </h2>
          </div>
          <p className="text-xs leading-relaxed text-[#5F6368] dark:text-[#C4C7C5]">
            IND HYPER CODING MODEL runs a deeper step-by-step architecture plan before coding,
            generates structured multi-file projects with one-click ZIP download, remembers up to{' '}
            {HYPER_CONTEXT_MESSAGE_LIMIT} messages of session context (compared to{' '}
            {STANDARD_CONTEXT_MESSAGE_LIMIT} messages on Standard), and performs an automatic
            second-pass bug &amp; completeness self-review before returning code.
          </p>
        </section>

        {/* Feature Comparison Table */}
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-[#1F1F1F] dark:text-[#E3E3E3]">
            Full Comparison
          </h2>
          <div className="overflow-x-auto rounded-2xl border border-[#E1E5EA] dark:border-[#333537] bg-white dark:bg-[#1E1F20]">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-[#E1E5EA] dark:border-[#2E3033] bg-[#F8FAFD] dark:bg-[#282A2C] text-[#5F6368] dark:text-[#9AA0A6]">
                <tr>
                  <th className="px-4 py-3 font-semibold">Capability</th>
                  <th className="px-4 py-3 font-semibold">Free</th>
                  <th className="px-4 py-3 font-semibold text-[#1A73E8] dark:text-[#8AB4F8]">
                    IND AGENT Plus (₹{PLUS_PRICE_INR}/mo)
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E1E5EA] dark:divide-[#2E3033]">
                {COMPARISON_ROWS.map((row) => (
                  <tr key={row.feature} className="hover:bg-[#F8FAFD] dark:hover:bg-[#282A2C]/60">
                    <td className="px-4 py-3 font-medium text-[#1F1F1F] dark:text-[#E3E3E3]">
                      {row.feature}
                    </td>
                    <td className="px-4 py-3 text-[#5F6368] dark:text-[#9AA0A6]">{row.free}</td>
                    <td className="px-4 py-3 font-medium text-[#1F1F1F] dark:text-[#E3E3E3]">
                      {row.plus}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* Cloud Sync & Accounts Note */}
        <section className="flex items-start gap-3 rounded-2xl border border-[#E1E5EA] dark:border-[#333537] bg-[#F8FAFD] dark:bg-[#1E1F20] p-4 text-xs text-[#5F6368] dark:text-[#9AA0A6]">
          <Cloud className="mt-0.5 h-4 w-4 shrink-0 text-[#1A73E8] dark:text-[#8AB4F8]" aria-hidden="true" />
          <div>
            <span className="font-semibold text-[#1F1F1F] dark:text-[#E3E3E3]">
              Firebase Cloud Storage &amp; 5-Hour Usage Sync:
            </span>{' '}
            Free Guest users get {GUEST_WINDOW_MESSAGE_LIMIT} messages every {USAGE_WINDOW_HOURS}{' '}
            hours. Sign in with Google to get {SIGNED_IN_WINDOW_MESSAGE_LIMIT} messages every{' '}
            {USAGE_WINDOW_HOURS} hours and persist your usage counter, Plus subscription status,
            chat history, memory, custom skills, and custom instructions directly in Firebase
            Firestore so nothing resets when the app restarts.
          </div>
        </section>
      </div>

      <UpiPaymentModal
        open={paymentModalOpen}
        onClose={() => setPaymentModalOpen(false)}
        billingSettings={billingSettings}
        userUid={authUser?.uid ?? ''}
        userEmail={authUser?.email ?? account.email ?? ''}
        isOwner={isOwner}
        onSubmitPayment={onSubmitPayment}
        onJumpToOwnerSetup={() => {
          ownerSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }}
      />
    </div>
  );
}
