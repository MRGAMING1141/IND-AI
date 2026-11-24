import { useState } from 'react';
import {
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Cloud,
  Gauge,
  LayoutGrid,
  LogOut,
  Moon,
  Pencil,
  Settings,
  Sun,
  X,
} from 'lucide-react';
import {
  GUEST_WINDOW_MESSAGE_LIMIT,
  SIGNED_IN_WINDOW_MESSAGE_LIMIT,
  USAGE_WINDOW_HOURS,
  formatResetCountdown,
} from '../utils/planEngine';
import type { UserAccountSummary } from '../types/agent';

export interface AccountSheetProfile {
  uid: string;
  displayName: string;
  email: string;
  photoURL?: string;
}

interface AccountSheetModalProps {
  open: boolean;
  onClose: () => void;
  authUser: AccountSheetProfile | null;
  authBusy: boolean;
  account: UserAccountSummary;
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
  onSignInGoogle: () => Promise<void>;
  onSignOutGoogle: () => Promise<void>;
  onOpenPlans: () => void;
  onOpenSettings: () => void;
  onOpenSkills: () => void;
  customInstructionsActive: boolean;
  skillCount: number;
}

function GoogleColorG() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5 shrink-0" aria-hidden="true">
      <path
        fill="#EA4335"
        d="M12 5.04c1.94 0 3.51.68 4.75 1.81l3.51-3.51C18.14 1.29 15.34 0 12 0 7.31 0 3.25 2.69 1.27 6.61l4.09 3.18C6.35 6.86 8.95 5.04 12 5.04z"
      />
      <path
        fill="#4285F4"
        d="M23.49 12.27c0-.79-.07-1.54-.19-2.27H12v4.51h6.47c-.29 1.48-1.14 2.73-2.4 3.58l3.7 2.87c2.16-1.99 3.72-4.93 3.72-8.69z"
      />
      <path
        fill="#FBBC05"
        d="M5.36 14.21A7.16 7.16 0 0 1 4.98 12c0-.77.14-1.51.38-2.21L1.27 6.61A11.96 11.96 0 0 0 0 12c0 1.94.46 3.77 1.27 5.39l4.09-3.18z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.7-2.87c-1.08.72-2.45 1.16-4.23 1.16-3.05 0-5.65-1.82-6.64-4.75l-4.09 3.18C3.25 21.31 7.31 24 12 24z"
      />
    </svg>
  );
}

function FourPointStar() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5 shrink-0 fill-current" aria-hidden="true">
      <path d="M12 2C12.7 7.1 16.9 11.3 22 12C16.9 12.7 12.7 16.9 12 22C11.3 16.9 7.1 12.7 2 12C7.1 11.3 11.3 7.1 12 2Z" />
    </svg>
  );
}

export function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'IA';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
}

export function AccountSheetModal({
  open,
  onClose,
  authUser,
  authBusy,
  account,
  theme,
  onToggleTheme,
  onSignInGoogle,
  onSignOutGoogle,
  onOpenPlans,
  onOpenSettings,
  onOpenSkills,
  customInstructionsActive,
  skillCount,
}: AccountSheetModalProps) {
  const [detailsExpanded, setDetailsExpanded] = useState(false);

  if (!open) return null;

  const isPlus = account?.plan === 'plus';
  const isGuest = !authUser && account?.authType === 'guest';
  const used = account?.usage?.used ?? 0;
  const limit =
    account?.usage?.limit ??
    (isGuest ? GUEST_WINDOW_MESSAGE_LIMIT : SIGNED_IN_WINDOW_MESSAGE_LIMIT);
  const resetCountdown = formatResetCountdown(account?.usage?.resetsAt);
  const displayName = authUser?.displayName || 'Guest Workspace';
  const subtitle = authUser?.email || `Sign in for ${SIGNED_IN_WINDOW_MESSAGE_LIMIT}/5h & Cloud sync`;
  const initials = getInitials(authUser?.displayName || 'IND AGENT');
  const tierShort = isPlus ? 'PLUS' : isGuest ? `GUEST ${used}/${limit}` : `FREE ${used}/${limit}`;
  const badgeText = isPlus ? 'Plus' : authUser ? 'Free' : 'Guest';

  return (
    <div
      className="fixed inset-0 z-50 flex items-stretch justify-center sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Account and workspace menu"
    >
      <div
        className="fixed inset-0 bg-black/35 backdrop-blur-[2px]"
        onClick={onClose}
      />

      <div className="relative z-10 flex h-full w-full flex-col justify-between overflow-y-auto bg-[#F0F4F9] dark:bg-[#131314] px-4 py-4 sm:h-auto sm:max-h-[90vh] sm:max-w-[420px] sm:rounded-[28px] sm:p-5 sm:shadow-2xl">
        <div className="space-y-3">
          {/* Top-right Close Button */}
          <div className="flex items-center justify-end pb-1">
            <button
              type="button"
              onClick={onClose}
              aria-label="Close account sheet"
              className="inline-flex h-10 w-10 items-center justify-center rounded-full text-[#1F1F1F] dark:text-[#E3E3E3] hover:bg-black/[0.06] dark:hover:bg-white/[0.08] transition-colors"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* Card 1: Profile Identity Card */}
          <div className="rounded-[24px] bg-white dark:bg-[#1E1F20] p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
            <div className="flex items-center gap-3.5">
              {/* Signature Ringed Avatar */}
              <div className="relative shrink-0">
                <div className="rounded-full bg-gradient-to-tr from-[#3B82F6] via-[#60A5FA] to-[#818CF8] p-[2.5px]">
                  <div className="rounded-full bg-white dark:bg-[#1E1F20] p-[2px]">
                    {authUser?.photoURL ? (
                      <img
                        src={authUser.photoURL}
                        alt={displayName}
                        referrerPolicy="no-referrer"
                        className="h-14 w-14 rounded-full object-cover"
                      />
                    ) : (
                      <span className="flex h-14 w-14 items-center justify-center rounded-full bg-[#689F38] text-[22px] font-normal tracking-tight text-white">
                        {initials}
                      </span>
                    )}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onOpenSettings();
                  }}
                  aria-label="Edit custom instructions and settings"
                  className="absolute -bottom-0.5 -right-0.5 flex h-6 w-6 items-center justify-center rounded-full bg-white dark:bg-[#282A2C] text-[#1F1F1F] dark:text-[#E3E3E3] shadow-sm ring-1 ring-black/10 dark:ring-white/10 hover:bg-[#F0F4F9] dark:hover:bg-[#333537]"
                >
                  <Pencil className="h-3 w-3" />
                </button>
              </div>

              <div className="min-w-0 flex-1">
                <div className="truncate text-[18px] font-medium leading-tight text-[#1F1F1F] dark:text-[#F1F3F4]">
                  {displayName}
                </div>
                <div className="mt-0.5 truncate text-[13px] text-[#5F6368] dark:text-[#9AA0A6]">
                  {subtitle}
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <span className="inline-flex items-center rounded-full border border-[#C6DAFC] dark:border-[#3B5998] bg-gradient-to-r from-[#EEF4FF] via-[#DCEBFF] to-[#F1EEFF] dark:from-[#1B2B44] dark:via-[#1E3352] dark:to-[#242640] px-2.5 py-0.5 text-[11px] font-semibold text-[#1F1F1F] dark:text-[#E3E3E3]">
                    {badgeText}
                  </span>
                  {authUser && (
                    <span className="inline-flex items-center gap-1 text-[11px] font-medium text-[#188038] dark:text-[#81C995]">
                      <Cloud className="h-3 w-3" />
                      Cloud Synced
                    </span>
                  )}
                </div>
              </div>

              <button
                type="button"
                onClick={() => setDetailsExpanded((v) => !v)}
                aria-expanded={detailsExpanded}
                aria-label="Toggle workspace storage details"
                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#F0F4F9] dark:bg-[#282A2C] text-[#444746] dark:text-[#C4C7C5] hover:bg-[#E1E5EA] dark:hover:bg-[#333537] transition-colors"
              >
                {detailsExpanded ? (
                  <ChevronUp className="h-4 w-4" />
                ) : (
                  <ChevronDown className="h-4 w-4" />
                )}
              </button>
            </div>

            {detailsExpanded && (
              <div className="mt-3.5 border-t border-[#F0F4F9] dark:border-[#2E3033] pt-3 text-xs text-[#444746] dark:text-[#C4C7C5] space-y-1.5">
                <div className="flex items-center justify-between">
                  <span>{USAGE_WINDOW_HOURS}-hour usage quota</span>
                  <span className="font-mono font-semibold tabular-nums text-[#1F1F1F] dark:text-[#F1F3F4]">
                    {isPlus ? 'Unlimited' : `${used} / ${limit}`}
                  </span>
                </div>
                {!isPlus && (
                  <div className="flex items-center justify-between">
                    <span>Window reset</span>
                    <span className="font-medium text-[#1F1F1F] dark:text-[#F1F3F4]">
                      {resetCountdown ? `In ${resetCountdown}` : `Every ${USAGE_WINDOW_HOURS} hours`}
                    </span>
                  </div>
                )}
                <div className="flex items-center justify-between">
                  <span>Usage &amp; chat storage</span>
                  <span className="font-medium text-[#1F1F1F] dark:text-[#F1F3F4]">
                    {authUser ? 'Saved in Firebase Firestore' : 'Temporary guest session'}
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* Card 2: Primary Google Account Action */}
          <div className="overflow-hidden rounded-[24px] bg-white dark:bg-[#1E1F20] shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
            {authUser ? (
              <button
                type="button"
                disabled={authBusy}
                onClick={() => {
                  void onSignOutGoogle();
                  onClose();
                }}
                className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left hover:bg-[#F8FAFD] dark:hover:bg-[#282A2C] disabled:opacity-50 transition-colors"
              >
                <span className="inline-flex items-center gap-4 min-w-0">
                  <GoogleColorG />
                  <span className="truncate text-[15px] font-medium text-[#1F1F1F] dark:text-[#E3E3E3]">
                    {authBusy ? 'Signing out...' : 'Sign out of Google Account'}
                  </span>
                </span>
                <LogOut className="h-4 w-4 shrink-0 text-[#5F6368] dark:text-[#9AA0A6]" />
              </button>
            ) : (
              <button
                type="button"
                disabled={authBusy}
                onClick={() => {
                  void onSignInGoogle();
                  onClose();
                }}
                className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left hover:bg-[#F8FAFD] dark:hover:bg-[#282A2C] disabled:opacity-50 transition-colors"
              >
                <span className="inline-flex items-center gap-4 min-w-0">
                  <GoogleColorG />
                  <span className="truncate text-[15px] font-medium text-[#1F1F1F] dark:text-[#E3E3E3]">
                    {authBusy ? 'Signing in...' : 'Sign in with Google'}
                  </span>
                </span>
                <span className="shrink-0 text-[11px] font-semibold text-[#1A73E8] dark:text-[#8AB4F8]">
                  {SIGNED_IN_WINDOW_MESSAGE_LIMIT} / {USAGE_WINDOW_HOURS}h
                </span>
              </button>
            )}
          </div>

          {/* Card 3: Grouped Plans & Upgrade Card */}
          <div className="overflow-hidden rounded-[24px] bg-white dark:bg-[#1E1F20] divide-y divide-[#F0F4F9] dark:divide-[#2E3033] shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
            <button
              type="button"
              onClick={() => {
                onClose();
                onOpenPlans();
              }}
              className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left hover:bg-[#F8FAFD] dark:hover:bg-[#282A2C] transition-colors"
            >
              <span className="inline-flex items-center gap-4 min-w-0">
                <Gauge className="h-5 w-5 shrink-0 text-[#444746] dark:text-[#C4C7C5]" strokeWidth={1.8} />
                <span className="truncate text-[15px] font-medium text-[#1F1F1F] dark:text-[#E3E3E3]">
                  Manage plans &amp; usage
                </span>
              </span>
              <span className="shrink-0 font-mono text-[12px] tracking-wide text-[#5F6368] dark:text-[#9AA0A6] tabular-nums">
                {tierShort}
              </span>
            </button>

            <button
              type="button"
              onClick={() => {
                onClose();
                onOpenPlans();
              }}
              className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left hover:bg-[#F8FAFD] dark:hover:bg-[#282A2C] transition-colors"
            >
              <span className="inline-flex items-center gap-4 min-w-0 text-[#1F1F1F] dark:text-[#E3E3E3]">
                <FourPointStar />
                <span className="truncate text-[15px] font-medium">
                  {isPlus ? 'IND AGENT Plus active' : 'Upgrade to IND AGENT Plus'}
                </span>
              </span>
              {isPlus && (
                <CheckCircle2 className="h-4 w-4 shrink-0 text-[#188038] dark:text-[#81C995]" />
              )}
            </button>
          </div>

          {/* Card 4: Grouped Settings, Skills & Appearance Card */}
          <div className="overflow-hidden rounded-[24px] bg-white dark:bg-[#1E1F20] divide-y divide-[#F0F4F9] dark:divide-[#2E3033] shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
            <button
              type="button"
              onClick={() => {
                onClose();
                onOpenSettings();
              }}
              className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left hover:bg-[#F8FAFD] dark:hover:bg-[#282A2C] transition-colors"
            >
              <span className="inline-flex items-center gap-4 min-w-0">
                <Settings className="h-5 w-5 shrink-0 text-[#444746] dark:text-[#C4C7C5]" strokeWidth={1.8} />
                <span className="truncate text-[15px] font-medium text-[#1F1F1F] dark:text-[#E3E3E3]">
                  Settings
                </span>
              </span>
              {customInstructionsActive && (
                <span className="shrink-0 text-[11px] font-medium text-[#188038] dark:text-[#81C995]">
                  Instructions On
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={() => {
                onClose();
                onOpenSkills();
              }}
              className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left hover:bg-[#F8FAFD] dark:hover:bg-[#282A2C] transition-colors"
            >
              <span className="inline-flex items-center gap-4 min-w-0">
                <LayoutGrid className="h-5 w-5 shrink-0 text-[#444746] dark:text-[#C4C7C5]" strokeWidth={1.8} />
                <span className="truncate text-[15px] font-medium text-[#1F1F1F] dark:text-[#E3E3E3]">
                  Skills Manager
                </span>
              </span>
              <span className="shrink-0 font-mono text-xs text-[#5F6368] dark:text-[#9AA0A6] tabular-nums">
                {skillCount}
              </span>
            </button>

            <button
              type="button"
              onClick={onToggleTheme}
              className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left hover:bg-[#F8FAFD] dark:hover:bg-[#282A2C] transition-colors"
            >
              <span className="inline-flex items-center gap-4 min-w-0">
                {theme === 'dark' ? (
                  <Sun className="h-5 w-5 shrink-0 text-[#444746] dark:text-[#C4C7C5]" strokeWidth={1.8} />
                ) : (
                  <Moon className="h-5 w-5 shrink-0 text-[#444746] dark:text-[#C4C7C5]" strokeWidth={1.8} />
                )}
                <span className="truncate text-[15px] font-medium text-[#1F1F1F] dark:text-[#E3E3E3]">
                  {theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
                </span>
              </span>
              <span className="shrink-0 text-xs text-[#5F6368] dark:text-[#9AA0A6]">
                {theme === 'dark' ? 'Dark' : 'Light'}
              </span>
            </button>
          </div>
        </div>

        {/* Quiet Bottom Legal / Brand Footer matching Screenshot 2 */}
        <div className="pt-8 pb-2 text-center text-[12px] text-[#5F6368] dark:text-[#9AA0A6]">
          <span>IND AGENT Cloud Storage</span>
          <span className="mx-2.5" aria-hidden="true">•</span>
          <span>Preview-first Approvals</span>
        </div>
      </div>
    </div>
  );
}
