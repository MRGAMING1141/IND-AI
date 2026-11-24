import { useEffect, useMemo, useState, type FormEvent } from 'react';
import QRCode from 'qrcode';
import {
  Check,
  CheckCircle2,
  Copy,
  ExternalLink,
  QrCode,
  ShieldCheck,
  Smartphone,
  X,
} from 'lucide-react';
import {
  PLUS_DURATION_DAYS,
  PLUS_PRICE_INR,
  buildUpiPaymentUri,
  isValidUpiId,
  isValidUtr,
  normalizeUtr,
} from '../utils/paymentEngine';
import type { BillingSettings } from '../types/agent';

interface UpiPaymentModalProps {
  open: boolean;
  onClose: () => void;
  billingSettings: BillingSettings | null;
  userUid: string;
  userEmail: string;
  isOwner: boolean;
  onSubmitPayment: (input: { utr: string; payerUpi?: string }) => Promise<void>;
  onJumpToOwnerSetup?: () => void;
}

export function UpiPaymentModal({
  open,
  onClose,
  billingSettings,
  userUid,
  userEmail,
  isOwner,
  onSubmitPayment,
  onJumpToOwnerSetup,
}: UpiPaymentModalProps) {
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [copiedUpi, setCopiedUpi] = useState(false);
  const [utr, setUtr] = useState('');
  const [payerUpi, setPayerUpi] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submittedUtr, setSubmittedUtr] = useState<string | null>(null);

  const upiId = billingSettings?.upiId?.trim() ?? '';
  const payeeName = billingSettings?.payeeName?.trim() || 'IND AGENT';
  const hasValidDestination = isValidUpiId(upiId);

  const paymentNote = useMemo(() => {
    const shortUid = (userUid || 'user').replace(/[^a-zA-Z0-9]/g, '').slice(0, 8) || 'user';
    return `INDAGENT-PLUS-${shortUid}`;
  }, [userUid]);

  const upiUri = useMemo(() => {
    if (!hasValidDestination) return '';
    try {
      return buildUpiPaymentUri({
        upiId,
        payeeName,
        amountInr: PLUS_PRICE_INR,
        note: paymentNote,
      });
    } catch {
      return '';
    }
  }, [hasValidDestination, upiId, payeeName, paymentNote]);

  useEffect(() => {
    if (!open || !upiUri) {
      setQrDataUrl(null);
      return;
    }
    let cancelled = false;
    QRCode.toDataURL(upiUri, {
      width: 220,
      margin: 2,
      errorCorrectionLevel: 'M',
      color: {
        dark: '#111827',
        light: '#FFFFFF',
      },
    })
      .then((url) => {
        if (!cancelled) setQrDataUrl(url);
      })
      .catch(() => {
        if (!cancelled) setQrDataUrl(null);
      });
    return () => {
      cancelled = true;
    };
  }, [open, upiUri]);

  useEffect(() => {
    if (!open) {
      setError(null);
      setSubmittedUtr(null);
      setUtr('');
      setPayerUpi('');
    }
  }, [open]);

  if (!open) return null;

  const handleCopyUpi = async () => {
    if (!upiId) return;
    try {
      await navigator.clipboard.writeText(upiId);
      setCopiedUpi(true);
      window.setTimeout(() => setCopiedUpi(false), 1800);
    } catch {
      // Ignore clipboard failure
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const cleanedUtr = normalizeUtr(utr);
    if (!isValidUtr(cleanedUtr)) {
      setError('Enter the valid 10–24 character UPI UTR / Reference number from FamApp or your UPI receipt (usually 12 digits).');
      return;
    }

    setSubmitting(true);
    try {
      await onSubmitPayment({
        utr: cleanedUtr,
        payerUpi: payerUpi.trim() || undefined,
      });
      setSubmittedUtr(cleanedUtr);
      setUtr('');
      setPayerUpi('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not submit payment verification.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-[2px]"
      role="dialog"
      aria-modal="true"
      aria-label="Pay via FamPay UPI for IND AGENT Plus"
    >
      <div className="relative flex max-h-[92vh] w-full max-w-lg flex-col overflow-hidden rounded-[28px] border border-[#E1E5EA] dark:border-[#333537] bg-white dark:bg-[#1E1F20] shadow-2xl">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b border-[#E1E5EA] dark:border-[#2E3033] px-6 py-4">
          <div>
            <h2 className="text-base font-semibold text-[#1F1F1F] dark:text-[#E3E3E3]">
              Upgrade to IND AGENT Plus
            </h2>
            <p className="mt-0.5 text-xs text-[#5F6368] dark:text-[#9AA0A6]">
              ₹{PLUS_PRICE_INR} for {PLUS_DURATION_DAYS} days · IND HYPER CODING MODEL · 100-msg context · Unlimited messages
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close payment modal"
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[#5F6368] hover:bg-[#F2F3F5] dark:hover:bg-[#282A2C]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto px-6 py-5 space-y-5">
          {!hasValidDestination ? (
            <div className="rounded-2xl border border-[#E1E5EA] dark:border-[#333537] bg-[#F8FAFD] dark:bg-[#131314] p-5 text-center space-y-3">
              <QrCode className="mx-auto h-8 w-8 text-[#5F6368] dark:text-[#9AA0A6]" />
              <div className="text-sm font-medium text-[#1F1F1F] dark:text-[#E3E3E3]">
                FamPay UPI ID not configured yet
              </div>
              <p className="text-xs leading-relaxed text-[#5F6368] dark:text-[#9AA0A6]">
                {isOwner
                  ? 'Enter your FamPay UPI ID (for example: yourname@fam) in the Owner FamPay Billing panel inside Plans & Usage so customers can scan and pay ₹200 directly to your FamPay account.'
                  : 'The workspace owner has not added their FamPay UPI ID yet. Please check back shortly.'}
              </p>
              {isOwner && onJumpToOwnerSetup && (
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onJumpToOwnerSetup();
                  }}
                  className="inline-flex items-center justify-center rounded-full bg-[#1A73E8] px-4 py-2 text-xs font-medium text-white hover:bg-[#1557B0] transition-colors"
                >
                  Configure My FamPay UPI ID
                </button>
              )}
            </div>
          ) : submittedUtr ? (
            <div className="rounded-2xl border border-[#B7DFBF] dark:border-[#1E4620] bg-[#E6F4EA] dark:bg-[#132A16] p-5 text-center space-y-3">
              <CheckCircle2 className="mx-auto h-9 w-9 text-[#188038] dark:text-[#81C995]" />
              <div className="text-sm font-semibold text-[#137333] dark:text-[#A8DAB5]">
                Payment Proof Submitted!
              </div>
              <p className="text-xs leading-relaxed text-[#1E4620] dark:text-[#C8E6C9]">
                UTR <code className="font-mono font-semibold">{submittedUtr}</code> has been logged for{' '}
                <span className="font-medium">{userEmail}</span>. Once verified in FamApp, IND AGENT Plus
                (IND HYPER CODING MODEL) will activate automatically on your account for {PLUS_DURATION_DAYS} days.
              </p>
              <button
                type="button"
                onClick={onClose}
                className="inline-flex items-center justify-center rounded-full bg-[#188038] px-5 py-2 text-xs font-medium text-white hover:bg-[#137333] transition-colors"
              >
                Done
              </button>
            </div>
          ) : (
            <>
              {/* Step 1: Scan or Pay via UPI */}
              <div className="rounded-2xl border border-[#E1E5EA] dark:border-[#333537] bg-[#F8FAFD] dark:bg-[#131314] p-4 space-y-4">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-[#1F1F1F] dark:text-[#E3E3E3]">
                    Step 1 · Pay ₹{PLUS_PRICE_INR} via FamPay / UPI
                  </span>
                  <span className="font-mono text-xs font-semibold text-[#1A73E8] dark:text-[#8AB4F8]">
                    ₹{PLUS_PRICE_INR}.00 INR
                  </span>
                </div>

                <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start">
                  {/* Scannable QR */}
                  <div className="flex shrink-0 flex-col items-center rounded-2xl border border-[#DDE3EA] bg-white p-2.5 shadow-sm">
                    {qrDataUrl ? (
                      <img
                        src={qrDataUrl}
                        alt={`UPI QR code to pay ₹${PLUS_PRICE_INR} to ${upiId}`}
                        className="h-36 w-36 rounded-lg"
                      />
                    ) : (
                      <div className="flex h-36 w-36 items-center justify-center text-xs text-[#5F6368]">
                        Generating QR...
                      </div>
                    )}
                    <span className="mt-1.5 text-[10px] font-medium text-[#5F6368]">
                      Scan with FamApp / GPay / PhonePe
                    </span>
                  </div>

                  {/* UPI Details & Mobile Deep Link */}
                  <div className="min-w-0 flex-1 space-y-2.5 text-xs">
                    <div>
                      <div className="text-[11px] text-[#5F6368] dark:text-[#9AA0A6]">Payee</div>
                      <div className="font-medium text-[#1F1F1F] dark:text-[#E3E3E3] truncate">
                        {payeeName}
                      </div>
                    </div>

                    <div>
                      <div className="text-[11px] text-[#5F6368] dark:text-[#9AA0A6]">FamPay / UPI ID</div>
                      <div className="mt-0.5 flex items-center gap-2">
                        <code className="min-w-0 flex-1 truncate rounded-lg border border-[#DDE3EA] dark:border-[#3C4043] bg-white dark:bg-[#1E1F20] px-2.5 py-1.5 font-mono text-xs text-[#1F1F1F] dark:text-[#E3E3E3]">
                          {upiId}
                        </code>
                        <button
                          type="button"
                          onClick={() => void handleCopyUpi()}
                          className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-[#DDE3EA] dark:border-[#3C4043] bg-white dark:bg-[#1E1F20] px-2.5 py-1.5 text-xs font-medium text-[#1F1F1F] dark:text-[#E3E3E3] hover:bg-[#F0F4F9] dark:hover:bg-[#282A2C] transition-colors"
                        >
                          {copiedUpi ? (
                            <>
                              <Check className="h-3.5 w-3.5 text-[#188038]" />
                              Copied
                            </>
                          ) : (
                            <>
                              <Copy className="h-3.5 w-3.5" />
                              Copy
                            </>
                          )}
                        </button>
                      </div>
                    </div>

                    <div>
                      <div className="text-[11px] text-[#5F6368] dark:text-[#9AA0A6]">Reference Note</div>
                      <div className="font-mono text-[11px] text-[#444746] dark:text-[#C4C7C5]">
                        {paymentNote}
                      </div>
                    </div>

                    {upiUri && (
                      <a
                        href={upiUri}
                        className="inline-flex w-full items-center justify-center gap-1.5 rounded-full bg-[#1A73E8] dark:bg-[#8AB4F8] px-3.5 py-2 text-xs font-semibold text-white dark:text-[#041E49] hover:bg-[#1557B0] dark:hover:bg-[#A8C7FA] transition-colors"
                      >
                        <Smartphone className="h-3.5 w-3.5" />
                        <span>Pay ₹{PLUS_PRICE_INR} in FamApp / UPI</span>
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                  </div>
                </div>
              </div>

              {/* Step 2: Submit 12-Digit UTR */}
              <form onSubmit={(e) => void handleSubmit(e)} className="space-y-3.5">
                <div className="text-xs font-semibold text-[#1F1F1F] dark:text-[#E3E3E3]">
                  Step 2 · Submit Your 12-Digit UPI UTR / Reference Number
                </div>

                <div className="space-y-1.5">
                  <label
                    htmlFor="upi-utr-input"
                    className="block text-xs text-[#5F6368] dark:text-[#9AA0A6]"
                  >
                    UPI UTR / Reference Number <span className="text-[#D93025]">*</span>
                  </label>
                  <input
                    id="upi-utr-input"
                    type="text"
                    required
                    value={utr}
                    onChange={(e) => setUtr(e.target.value)}
                    placeholder="e.g. 432719845612"
                    maxLength={28}
                    autoComplete="off"
                    className="w-full rounded-xl border border-[#DDE3EA] dark:border-[#3C4043] bg-white dark:bg-[#131314] px-3.5 py-2.5 font-mono text-sm text-[#1F1F1F] dark:text-[#E3E3E3] placeholder:text-[#9AA0A6] focus:border-[#1A73E8] focus:outline-none"
                  />
                  <p className="text-[11px] text-[#5F6368] dark:text-[#9AA0A6]">
                    Find this 12-digit UTR / UPI Ref ID on your FamApp, GPay, PhonePe, or Paytm payment receipt.
                  </p>
                </div>

                <div className="space-y-1.5">
                  <label
                    htmlFor="payer-upi-input"
                    className="block text-xs text-[#5F6368] dark:text-[#9AA0A6]"
                  >
                    Your UPI ID or Sender Name (optional)
                  </label>
                  <input
                    id="payer-upi-input"
                    type="text"
                    value={payerUpi}
                    onChange={(e) => setPayerUpi(e.target.value)}
                    placeholder="e.g. yourname@fam"
                    maxLength={90}
                    className="w-full rounded-xl border border-[#DDE3EA] dark:border-[#3C4043] bg-white dark:bg-[#131314] px-3.5 py-2 text-xs text-[#1F1F1F] dark:text-[#E3E3E3] placeholder:text-[#9AA0A6] focus:border-[#1A73E8] focus:outline-none"
                  />
                </div>

                {error && (
                  <div
                    role="alert"
                    className="rounded-xl border border-[#F5C2C0] bg-[#FCE8E6] dark:bg-[#3B1E1D] px-3.5 py-2 text-xs text-[#A50E0E] dark:text-[#F6AEA9]"
                  >
                    {error}
                  </div>
                )}

                <div className="flex items-center justify-between gap-3 pt-1">
                  <div className="flex items-center gap-1.5 text-[11px] text-[#5F6368] dark:text-[#9AA0A6]">
                    <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-[#188038] dark:text-[#81C995]" />
                    <span>Saved securely in Firebase</span>
                  </div>
                  <button
                    type="submit"
                    disabled={submitting || !utr.trim()}
                    className="inline-flex items-center justify-center rounded-full bg-[#1A73E8] dark:bg-[#8AB4F8] px-5 py-2.5 text-xs font-semibold text-white dark:text-[#041E49] hover:bg-[#1557B0] dark:hover:bg-[#A8C7FA] disabled:opacity-50 transition-colors"
                  >
                    {submitting ? 'Submitting...' : 'Submit UTR for Verification'}
                  </button>
                </div>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
