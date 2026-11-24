import { useEffect, useState } from 'react';
import {
  Check,
  Cloud,
  LogIn,
  LogOut,
  Moon,
  Settings,
  Sliders,
  Sun,
  Trash2,
  X,
} from 'lucide-react';
import { MAX_CUSTOM_INSTRUCTIONS_CHARS } from '../utils/skillsEngine';
import type { CustomInstructionsConfig } from '../types/agent';

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
  customInstructions: CustomInstructionsConfig;
  onSaveCustomInstructions: (config: CustomInstructionsConfig) => Promise<void>;
  theme: 'light' | 'dark';
  onThemeChange: (theme: 'light' | 'dark') => void;
  prefs: {
    fastMode: boolean;
    debugLoop: boolean;
    showTasks: boolean;
    memoryEnabled: boolean;
  };
  onTogglePref: (key: 'fastMode' | 'debugLoop' | 'showTasks' | 'memoryEnabled') => void;
  authUser: {
    uid: string;
    displayName: string;
    email: string;
    photoURL?: string;
  } | null;
  authBusy: boolean;
  onSignInGoogle: () => Promise<void>;
  onSignOutGoogle: () => Promise<void>;
  sessionCount: number;
  memoryCount: number;
  onClearAllChats: () => Promise<void>;
  onClearMemoryFacts: () => Promise<void>;
}

const INSTRUCTION_PRESETS: Array<{ label: string; text: string }> = [
  {
    label: 'Principal Full-Stack Dev',
    text: 'Always write production-ready, clean modular TypeScript/React/Node code with strong error handling, responsive design, and zero stubs. Keep explanations concise and lead with the architectural decision.',
  },
  {
    label: 'Roblox Luau Specialist',
    text: 'Write strict, OOP Roblox Luau code using TweenService, UserInputService, and Maid connection cleanup. Always provide a runnable DemoUsage.luau example and avoid deprecated Roblox APIs.',
  },
  {
    label: 'Concise Executive Ops',
    text: 'Keep responses crisp, scannable, and action-oriented using bullet points and tables. For business emails, maintain a polite Indian-business tone in English, Hindi, or Gujarati as requested.',
  },
];

export function SettingsModal({
  open,
  onClose,
  customInstructions,
  onSaveCustomInstructions,
  theme,
  onThemeChange,
  prefs,
  onTogglePref,
  authUser,
  authBusy,
  onSignInGoogle,
  onSignOutGoogle,
  sessionCount,
  memoryCount,
  onClearAllChats,
  onClearMemoryFacts,
}: SettingsModalProps) {
  const [draftText, setDraftText] = useState(customInstructions.text);
  const [draftEnabled, setDraftEnabled] = useState(customInstructions.enabled);
  const [saving, setSaving] = useState(false);
  const [savedFeedback, setSavedFeedback] = useState(false);
  const [confirmClearChats, setConfirmClearChats] = useState(false);
  const [confirmClearMemory, setConfirmClearMemory] = useState(false);

  useEffect(() => {
    if (open) {
      setDraftText(customInstructions.text);
      setDraftEnabled(customInstructions.enabled);
      setSavedFeedback(false);
      setConfirmClearChats(false);
      setConfirmClearMemory(false);
    }
  }, [open, customInstructions.text, customInstructions.enabled]);

  if (!open) return null;

  const charCount = draftText.length;
  const charPct = Math.min(100, Math.round((charCount / MAX_CUSTOM_INSTRUCTIONS_CHARS) * 100));
  const isDirty =
    draftText !== customInstructions.text || draftEnabled !== customInstructions.enabled;

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await onSaveCustomInstructions({
        text: draftText.slice(0, MAX_CUSTOM_INSTRUCTIONS_CHARS),
        enabled: draftEnabled,
      });
      setSavedFeedback(true);
      window.setTimeout(() => setSavedFeedback(false), 2000);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-[2px] p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Workspace Settings"
    >
      <div className="flex max-h-[88vh] w-full max-w-2xl flex-col rounded-2xl border border-[#DDE3EA] dark:border-[#333537] bg-white dark:bg-[#1E1F20] shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between gap-3 border-b border-[#E1E5EA] dark:border-[#2E3033] px-6 py-4">
          <div className="flex items-center gap-2.5">
            <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#F0F4F9] dark:bg-[#282A2C] text-[#1A73E8] dark:text-[#8AB4F8]">
              <Settings className="h-4.5 w-4.5" aria-hidden="true" />
            </span>
            <div>
              <h2 className="text-base font-semibold text-[#1F1F1F] dark:text-[#E3E3E3]">
                Settings
              </h2>
              <p className="text-xs text-[#5F6368] dark:text-[#9AA0A6]">
                Custom instructions for IND AGENT, appearance, cloud account &amp; chat controls
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close Settings"
            className="inline-flex h-8 w-8 items-center justify-center rounded-full text-[#5F6368] hover:bg-[#F0F4F9] dark:hover:bg-[#282A2C] hover:text-[#1F1F1F] dark:hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
          {/* Section 1: Custom Instructions (1,500 chars limit) */}
          <form onSubmit={handleSave} className="space-y-3.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Sliders className="h-4 w-4 text-[#1A73E8] dark:text-[#8AB4F8]" aria-hidden="true" />
                <h3 className="text-sm font-semibold text-[#1F1F1F] dark:text-[#E3E3E3]">
                  Custom Instructions to Bot
                </h3>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={draftEnabled}
                onClick={() => setDraftEnabled((v) => !v)}
                className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                  draftEnabled
                    ? 'bg-[#E8F0FE] dark:bg-[#004A77]/60 text-[#1A73E8] dark:text-[#C2E7FF]'
                    : 'bg-[#F0F4F9] dark:bg-[#282A2C] text-[#5F6368] dark:text-[#9AA0A6]'
                }`}
              >
                <span>{draftEnabled ? 'Enabled' : 'Disabled'}</span>
              </button>
            </div>

            <p className="text-xs leading-relaxed text-[#5F6368] dark:text-[#9AA0A6]">
              Guide how IND AGENT writes code, formats responses, or addresses you across every
              conversation (up to 1,500 characters). Safety rules like preview-first approvals remain
              protected.
            </p>

            {/* Quick Presets */}
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] font-medium text-[#5F6368] dark:text-[#9AA0A6] mr-1">
                Presets:
              </span>
              {INSTRUCTION_PRESETS.map((preset) => (
                <button
                  key={preset.label}
                  type="button"
                  onClick={() => {
                    setDraftText(preset.text.slice(0, MAX_CUSTOM_INSTRUCTIONS_CHARS));
                    setDraftEnabled(true);
                  }}
                  className="rounded-full border border-[#DDE3EA] dark:border-[#3C4043] bg-[#F8FAFD] dark:bg-[#131314] px-2.5 py-1 text-[11px] font-medium text-[#444746] dark:text-[#C4C7C5] hover:border-[#1A73E8] dark:hover:border-[#8AB4F8] hover:text-[#1A73E8] dark:hover:text-[#8AB4F8] transition-colors"
                >
                  {preset.label}
                </button>
              ))}
            </div>

            <div className="space-y-1.5">
              <label htmlFor="custom-instructions-textarea" className="sr-only">
                Custom instructions for IND AGENT
              </label>
              <textarea
                id="custom-instructions-textarea"
                rows={5}
                value={draftText}
                onChange={(e) =>
                  setDraftText(e.target.value.slice(0, MAX_CUSTOM_INSTRUCTIONS_CHARS))
                }
                maxLength={MAX_CUSTOM_INSTRUCTIONS_CHARS}
                placeholder="Example: Always use TypeScript with Tailwind CSS, explain trade-offs briefly, and never leave TODO comments..."
                className="w-full rounded-2xl border border-[#DDE3EA] dark:border-[#3C4043] bg-[#F8FAFD] dark:bg-[#131314] px-4 py-3 text-xs leading-relaxed text-[#1F1F1F] dark:text-[#E3E3E3] placeholder:text-[#5F6368] dark:placeholder:text-[#8E918F] focus:border-[#1A73E8] dark:focus:border-[#8AB4F8] focus:bg-white dark:focus:bg-[#18191A] focus:outline-none"
              />
              <div className="flex items-center justify-between gap-3 px-1">
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[#E8EDF4] dark:bg-[#282A2C]">
                  <div
                    className={`h-full transition-all ${
                      charCount >= MAX_CUSTOM_INSTRUCTIONS_CHARS
                        ? 'bg-[#D93025]'
                        : charCount >= 1200
                          ? 'bg-[#F9AB00]'
                          : 'bg-[#1A73E8] dark:bg-[#8AB4F8]'
                    }`}
                    style={{ width: `${charPct}%` }}
                  />
                </div>
                <span
                  data-testid="custom-instructions-counter"
                  className={`font-mono text-[11px] tabular-nums shrink-0 ${
                    charCount >= MAX_CUSTOM_INSTRUCTIONS_CHARS
                      ? 'font-semibold text-[#D93025] dark:text-[#F28B82]'
                      : 'text-[#5F6368] dark:text-[#9AA0A6]'
                  }`}
                >
                  {charCount} / {MAX_CUSTOM_INSTRUCTIONS_CHARS}
                </span>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
              <button
                type="button"
                disabled={!draftText}
                onClick={() => setDraftText('')}
                className="text-xs font-medium text-[#5F6368] hover:text-[#D93025] disabled:opacity-40"
              >
                Clear text
              </button>
              <div className="flex items-center gap-2">
                {savedFeedback && (
                  <span className="inline-flex items-center gap-1 text-xs font-medium text-[#188038] dark:text-[#81C995]">
                    <Check className="h-3.5 w-3.5" />
                    Saved
                  </span>
                )}
                <button
                  type="submit"
                  disabled={saving || (!isDirty && savedFeedback)}
                  className="rounded-full bg-[#1A73E8] px-4 py-1.5 text-xs font-medium text-white hover:bg-[#1557B0] disabled:opacity-50 transition-colors"
                >
                  {saving ? 'Saving...' : 'Save Instructions'}
                </button>
              </div>
            </div>
          </form>

          {/* Section 2: Appearance & AI Defaults */}
          <div className="border-t border-[#E1E5EA] dark:border-[#2E3033] pt-5 space-y-3">
            <h3 className="text-sm font-semibold text-[#1F1F1F] dark:text-[#E3E3E3]">
              Appearance &amp; Workspace Defaults
            </h3>

            <div className="flex items-center justify-between gap-3 rounded-xl bg-[#F8FAFD] dark:bg-[#131314] px-4 py-3">
              <div>
                <div className="text-xs font-medium text-[#1F1F1F] dark:text-[#E3E3E3]">Theme</div>
                <div className="text-[11px] text-[#5F6368] dark:text-[#9AA0A6]">
                  Switch between clean light and dark workspace themes
                </div>
              </div>
              <div className="inline-flex items-center rounded-full border border-[#DDE3EA] dark:border-[#3C4043] bg-white dark:bg-[#1E1F20] p-0.5">
                <button
                  type="button"
                  onClick={() => onThemeChange('light')}
                  className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                    theme === 'light'
                      ? 'bg-[#E8F0FE] text-[#1A73E8]'
                      : 'text-[#5F6368] dark:text-[#9AA0A6]'
                  }`}
                >
                  <Sun className="h-3.5 w-3.5" />
                  Light
                </button>
                <button
                  type="button"
                  onClick={() => onThemeChange('dark')}
                  className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                    theme === 'dark'
                      ? 'bg-[#004A77] text-[#C2E7FF]'
                      : 'text-[#5F6368] dark:text-[#9AA0A6]'
                  }`}
                >
                  <Moon className="h-3.5 w-3.5" />
                  Dark
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {(
                [
                  { key: 'fastMode', label: 'Fast Mode', desc: 'Quicker streaming responses' },
                  { key: 'debugLoop', label: 'Auto-Debug Loop', desc: 'Verify & auto-repair code' },
                  { key: 'showTasks', label: 'Show AI Tasks', desc: 'Display live step timeline' },
                  { key: 'memoryEnabled', label: 'Chat Memory', desc: 'Remember facts across chats' },
                ] as const
              ).map((item) => {
                const active = prefs[item.key];
                return (
                  <button
                    key={item.key}
                    type="button"
                    role="switch"
                    aria-checked={active}
                    onClick={() => onTogglePref(item.key)}
                    className="flex items-center justify-between gap-2 rounded-xl border border-[#E8EDF4] dark:border-[#2E3033] bg-[#F8FAFD] dark:bg-[#131314] px-3.5 py-2.5 text-left hover:border-[#C2D4EE] dark:hover:border-[#3C4043] transition-colors"
                  >
                    <div className="min-w-0">
                      <div className="text-xs font-medium text-[#1F1F1F] dark:text-[#E3E3E3]">
                        {item.label}
                      </div>
                      <div className="text-[11px] text-[#5F6368] dark:text-[#9AA0A6] truncate">
                        {item.desc}
                      </div>
                    </div>
                    <span
                      className={`font-mono text-[10px] font-semibold uppercase px-2 py-0.5 rounded-full shrink-0 ${
                        active
                          ? 'bg-[#E8F0FE] dark:bg-[#004A77] text-[#1A73E8] dark:text-[#C2E7FF]'
                          : 'bg-[#E8EDF4] dark:bg-[#282A2C] text-[#5F6368] dark:text-[#9AA0A6]'
                      }`}
                    >
                      {active ? 'On' : 'Off'}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Section 3: Account & Cloud Sync */}
          <div className="border-t border-[#E1E5EA] dark:border-[#2E3033] pt-5 space-y-3">
            <h3 className="text-sm font-semibold text-[#1F1F1F] dark:text-[#E3E3E3]">
              Account &amp; Cloud Sync
            </h3>
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#E8EDF4] dark:border-[#2E3033] bg-[#F8FAFD] dark:bg-[#131314] px-4 py-3">
              {authUser ? (
                <>
                  <div className="flex items-center gap-3 min-w-0">
                    {authUser.photoURL ? (
                      <img
                        src={authUser.photoURL}
                        alt={authUser.displayName}
                        referrerPolicy="no-referrer"
                        className="h-9 w-9 rounded-full object-cover"
                      />
                    ) : (
                      <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-[#1A73E8] text-xs font-semibold text-white">
                        {authUser.displayName.slice(0, 1).toUpperCase()}
                      </span>
                    )}
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 text-xs font-semibold text-[#1F1F1F] dark:text-[#E3E3E3]">
                        <span className="truncate">{authUser.displayName}</span>
                        <Cloud className="h-3.5 w-3.5 text-[#188038] dark:text-[#81C995] shrink-0" />
                      </div>
                      <div className="truncate text-[11px] text-[#5F6368] dark:text-[#9AA0A6]">
                        {authUser.email} · Chats, memory, skills &amp; instructions synced
                      </div>
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={authBusy}
                    onClick={() => void onSignOutGoogle()}
                    className="inline-flex items-center gap-1.5 rounded-full border border-[#DDE3EA] dark:border-[#3C4043] bg-white dark:bg-[#1E1F20] px-3.5 py-1.5 text-xs font-medium text-[#444746] dark:text-[#E3E3E3] hover:bg-[#F0F4F9] dark:hover:bg-[#282A2C]"
                  >
                    <LogOut className="h-3.5 w-3.5" />
                    Sign out
                  </button>
                </>
              ) : (
                <>
                  <div className="min-w-0">
                    <div className="text-xs font-semibold text-[#1F1F1F] dark:text-[#E3E3E3]">
                      Guest Mode (10 msgs/day · Temporary session)
                    </div>
                    <div className="text-[11px] text-[#5F6368] dark:text-[#9AA0A6]">
                      Sign in with Google for 100 msgs/day and Cloud Storage for all chats, memory, skills &amp; instructions
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={authBusy}
                    onClick={() => void onSignInGoogle()}
                    className="inline-flex items-center gap-1.5 rounded-full bg-[#1A73E8] px-3.5 py-1.5 text-xs font-medium text-white hover:bg-[#1557B0] disabled:opacity-50"
                  >
                    <LogIn className="h-3.5 w-3.5" />
                    {authBusy ? 'Signing in...' : 'Sign in with Google'}
                  </button>
                </>
              )}
            </div>
          </div>

          {/* Section 4: Data & Chat History Controls */}
          <div className="border-t border-[#E1E5EA] dark:border-[#2E3033] pt-5 space-y-3">
            <h3 className="text-sm font-semibold text-[#1F1F1F] dark:text-[#E3E3E3]">
              Chat History &amp; Memory Data
            </h3>
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#E8EDF4] dark:border-[#2E3033] bg-[#F8FAFD] dark:bg-[#131314] px-4 py-3">
              <div>
                <div className="text-xs font-medium text-[#1F1F1F] dark:text-[#E3E3E3]">
                  {authUser ? `Cloud Saved Chats (${sessionCount})` : `Current Session Chats (${sessionCount})`}
                </div>
                <div className="text-[11px] text-[#5F6368] dark:text-[#9AA0A6]">
                  {authUser
                    ? 'Delete all chat conversations recorded in your Firestore Cloud Storage'
                    : 'Guest chats are never saved locally — clear active session chats'}
                </div>
              </div>
              {confirmClearChats ? (
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setConfirmClearChats(false)}
                    className="rounded-full border border-[#DDE3EA] dark:border-[#3C4043] px-3 py-1 text-xs font-medium text-[#5F6368]"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      await onClearAllChats();
                      setConfirmClearChats(false);
                    }}
                    className="rounded-full bg-[#D93025] px-3 py-1 text-xs font-medium text-white hover:bg-[#B3261E]"
                  >
                    Confirm Delete All
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  disabled={sessionCount === 0}
                  onClick={() => setConfirmClearChats(true)}
                  className="inline-flex items-center gap-1.5 rounded-full border border-[#F5C2C0] dark:border-[#5C2B29] bg-white dark:bg-[#1E1F20] px-3 py-1.5 text-xs font-medium text-[#D93025] dark:text-[#F28B82] hover:bg-[#FCE8E6] dark:hover:bg-[#3B1E1D] disabled:opacity-40"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Delete all chats
                </button>
              )}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#E8EDF4] dark:border-[#2E3033] bg-[#F8FAFD] dark:bg-[#131314] px-4 py-3">
              <div>
                <div className="text-xs font-medium text-[#1F1F1F] dark:text-[#E3E3E3]">
                  Chat Memory Facts ({memoryCount})
                </div>
                <div className="text-[11px] text-[#5F6368] dark:text-[#9AA0A6]">
                  Clear all remembered preferences and notes
                </div>
              </div>
              {confirmClearMemory ? (
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setConfirmClearMemory(false)}
                    className="rounded-full border border-[#DDE3EA] dark:border-[#3C4043] px-3 py-1 text-xs font-medium text-[#5F6368]"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      await onClearMemoryFacts();
                      setConfirmClearMemory(false);
                    }}
                    className="rounded-full bg-[#D93025] px-3 py-1 text-xs font-medium text-white hover:bg-[#B3261E]"
                  >
                    Confirm Clear
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  disabled={memoryCount === 0}
                  onClick={() => setConfirmClearMemory(true)}
                  className="inline-flex items-center gap-1.5 rounded-full border border-[#DDE3EA] dark:border-[#3C4043] bg-white dark:bg-[#1E1F20] px-3 py-1.5 text-xs font-medium text-[#444746] dark:text-[#C4C7C5] hover:text-[#D93025] disabled:opacity-40"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Clear memory
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
