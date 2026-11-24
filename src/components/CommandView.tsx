import { useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  ArrowUp,
  Brain,
  Briefcase,
  Bug,
  Check,
  ChevronDown,
  ChevronRight,
  Clock,
  Code2,
  Copy,
  CornerDownRight,
  ExternalLink,
  FileCode2,
  Globe,
  ImagePlus,
  ListChecks,
  Loader2,
  Lock,
  LogIn,
  Paperclip,
  Pause,
  Play,
  Plus,
  RotateCcw,
  ShieldCheck,
  Sliders,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  User,
  Wand2,
  X,
  Zap,
} from 'lucide-react';
import { MessageRenderer } from './MessageRenderer';
import { ActionCard } from './ActionCard';
import { PromptOptimizerPanel } from './PromptOptimizerPanel';
import { optimizeUserPrompt } from '../services/api';
import {
  MAX_TEXT_FILE_CHARS,
  formatBytes,
  validateAttachmentCandidate,
} from '../utils/attachments';
import { copyTextToClipboard } from '../utils/clipboard';
import { buildFollowUpSuggestions } from '../utils/followUpSuggestions';
import {
  GUEST_WINDOW_MESSAGE_LIMIT,
  SIGNED_IN_WINDOW_MESSAGE_LIMIT,
  USAGE_WINDOW_HOURS,
  formatResetCountdown,
} from '../utils/planEngine';
import { sanitizeExternalUrl } from '../utils/safetyEngine';
import { detectSlashQuery, filterSkills } from '../utils/skillsEngine';
import type {
  AgentMode,
  AgentTaskStep,
  ChatAttachment,
  ChatMessage,
  GeneratedProjectFile,
  MemoryFact,
  ModelChoice,
  PendingAction,
  PromptOptimizationFocus,
  PromptOptimizationResult,
  SkillDefinition,
  ToolStatusSummary,
  UserAccountSummary,
} from '../types/agent';

interface CommandViewProps {
  sessionId: string;
  messages: ChatMessage[];
  mode: AgentMode;
  onModeChange: (mode: AgentMode) => void;
  modelChoice: ModelChoice;
  onModelChoiceChange: (choice: ModelChoice) => void;
  showHyperUpgradePrompt: boolean;
  onDismissHyperUpgradePrompt: () => void;
  fastMode: boolean;
  onToggleFastMode: () => void;
  debugLoop: boolean;
  onToggleDebugLoop: () => void;
  showTasks: boolean;
  onToggleShowTasks: () => void;
  memoryEnabled: boolean;
  onToggleMemory: () => void;
  memoryFacts: MemoryFact[];
  onAddMemoryFact: (content: string, category: MemoryFact['category']) => Promise<void>;
  onDeleteMemoryFact: (id: string) => Promise<void>;
  onClearMemoryFacts: () => Promise<void>;
  skills: SkillDefinition[];
  onOpenSkillsModal: () => void;
  suppressSlashPalette?: boolean;
  customInstructionsActive: boolean;
  onOpenSettingsModal: () => void;
  contextDrawerOpen: boolean;
  onCloseContextDrawer: () => void;
  account: UserAccountSummary;
  draftInput: string;
  onDraftInputChange: (val: string) => void;
  onSend: (
    text: string,
    attachments?: ChatAttachment[],
    options?: {
      modelChoiceOverride?: ModelChoice;
      replaceErrorMessageId?: string;
    }
  ) => Promise<void>;
  sending: boolean;
  liveTasks: AgentTaskStep[];
  streamingReply: string;
  actions: PendingAction[];
  onApproveAction: (id: string) => Promise<void>;
  onRejectAction: (id: string) => Promise<void>;
  onQueueDraft: (draft: { to: string; subject: string; body: string; language: string }) => Promise<void>;
  onQueueSaveToDrive: (file: { name: string; content: string }) => Promise<void>;
  onPreviewHtml: (html: string) => void;
  onOpenArtifact: (payload: {
    title: string;
    files: GeneratedProjectFile[];
    activePath: string;
    sourceMessageId?: string;
  }) => void;
  activeArtifactSourceMessageId?: string;
  onNavigateApprovals: () => void;
  onNavigateTools: () => void;
  onNavigatePlans: () => void;
  onSignInGoogle?: () => Promise<void>;
  authBusy?: boolean;
  toolStatus: ToolStatusSummary;
}

const SUGGESTION_PROMPTS: Array<{
  title: string;
  icon: 'user' | 'briefcase' | 'code';
  mode: AgentMode;
  prompt: string;
}> = [
  {
    title: 'Engineer a structured prompt',
    icon: 'user',
    mode: 'auto',
    prompt: '/prompt build a multi-tenant SaaS invoice tracker in Next.js with GST calculation',
  },
  {
    title: 'Draft a professional client email',
    icon: 'briefcase',
    mode: 'business',
    prompt:
      '/email Write a concise, warm follow-up email to a client sharing project milestones and next week deliverables',
  },
  {
    title: 'Custom Roblox Luau UI library',
    icon: 'code',
    mode: 'coding',
    prompt:
      '/luau draggable dark/light UI library with tabs, toggles, sliders, dropdowns, keybinds, toast notifications, and config export',
  },
];

/** Signature 3-bar minimal icon matching the soft ice-blue circular action button in reference */
function SoundWaveActionIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" aria-hidden="true">
      <line x1="7" y1="9.5" x2="7" y2="14.5" />
      <line x1="12" y1="6.5" x2="12" y2="17.5" />
      <line x1="17" y1="9.5" x2="17" y2="14.5" />
    </svg>
  );
}

function formatDuration(ms?: number): string {
  if (!ms || !Number.isFinite(ms)) return '';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(new Error(`Could not read "${file.name}".`));
    reader.readAsDataURL(file);
  });
}

/** Crisp 4-point Gemini-inspired star mark for IND AGENT responses */
function IndSparkMark({ spinning = false }: { spinning?: boolean }) {
  return (
    <span
      className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#E8F0FE] dark:bg-[#1E293B] text-[#1A73E8] dark:text-[#8AB4F8] ${
        spinning ? 'animate-pulse' : ''
      }`}
      aria-hidden="true"
    >
      <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current">
        <path d="M12 2C12.7 7.1 16.9 11.3 22 12C16.9 12.7 12.7 16.9 12 22C11.3 16.9 7.1 12.7 2 12C7.1 11.3 11.3 7.1 12 2Z" />
      </svg>
    </span>
  );
}

function TaskTimeline({
  tasks,
  live = false,
  elapsedMs,
}: {
  tasks: AgentTaskStep[];
  live?: boolean;
  elapsedMs?: number;
}) {
  const [expanded, setExpanded] = useState(live);
  if (!Array.isArray(tasks) || tasks.length === 0) return null;

  const isOpen = live || expanded;

  return (
    <div className="rounded-2xl bg-[#F0F4F9] dark:bg-[#1E1F20] px-4 py-2.5 text-xs">
      <button
        type="button"
        onClick={() => {
          if (!live) setExpanded((prev) => !prev);
        }}
        className={`flex w-full items-center justify-between gap-2 text-left ${
          live ? 'cursor-default' : 'cursor-pointer'
        }`}
      >
        <span className="inline-flex items-center gap-2 font-medium text-[#444746] dark:text-[#C4C7C5]">
          {live ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin text-[#1A73E8] dark:text-[#8AB4F8]" aria-hidden="true" />
          ) : isOpen ? (
            <ChevronDown className="h-3.5 w-3.5 text-[#5F6368] dark:text-[#9AA0A6]" aria-hidden="true" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 text-[#5F6368] dark:text-[#9AA0A6]" aria-hidden="true" />
          )}
          <span>{live ? 'AI is working' : 'Show thinking & steps'}</span>
          <span className="font-mono text-[11px] text-[#5F6368] dark:text-[#9AA0A6] tabular-nums">
            · {tasks.length} step{tasks.length === 1 ? '' : 's'}
            {elapsedMs ? ` · ${formatDuration(elapsedMs)}` : ''}
          </span>
        </span>
        {!live && (
          <span className="text-[11px] font-medium text-[#1A73E8] dark:text-[#8AB4F8]">
            {isOpen ? 'Hide' : 'View'}
          </span>
        )}
      </button>

      {isOpen && (
        <ul className="mt-2.5 space-y-1.5 border-t border-[#DDE3EA] dark:border-[#2E3033] pt-2.5">
          {tasks.map((step) => (
            <li key={step.id} className="flex items-start justify-between gap-2">
              <div className="flex items-start gap-2 min-w-0">
                {step.status === 'running' ? (
                  <Loader2 className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin text-[#1A73E8] dark:text-[#8AB4F8]" />
                ) : step.status === 'error' ? (
                  <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#D93025] dark:text-[#F28B82]" />
                ) : (
                  <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#188038] dark:text-[#81C995]" />
                )}
                <div className="min-w-0">
                  <span className="font-medium text-[#1F1F1F] dark:text-[#E3E3E3]">
                    {step.label}
                  </span>
                  {step.detail && (
                    <span className="ml-1.5 text-[#5F6368] dark:text-[#9AA0A6] break-words">
                      — {step.detail}
                    </span>
                  )}
                </div>
              </div>
              {step.durationMs !== undefined && (
                <span className="font-mono text-[11px] tabular-nums text-[#5F6368] dark:text-[#9AA0A6] shrink-0">
                  {formatDuration(step.durationMs)}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function RateLimitCooldownCard({
  msg,
  isLatest,
  sending,
  currentModelChoice,
  onRetryNow,
  onSwitchStandardAndRetry,
}: {
  msg: ChatMessage;
  isLatest: boolean;
  sending: boolean;
  currentModelChoice: ModelChoice;
  onRetryNow: () => void;
  onSwitchStandardAndRetry: () => void;
}) {
  const initialSeconds = Math.max(2, Math.min(120, msg.retryAfterSec ?? 20));
  const [secondsLeft, setSecondsLeft] = useState<number>(initialSeconds);
  const [autoPaused, setAutoPaused] = useState<boolean>(!isLatest || !msg.retryPrompt);
  const triggeredRef = useRef<boolean>(false);
  const onRetryNowRef = useRef(onRetryNow);
  onRetryNowRef.current = onRetryNow;

  // Stop auto-retry if a newer message arrives
  useEffect(() => {
    if (!isLatest) {
      setAutoPaused(true);
    }
  }, [isLatest]);

  useEffect(() => {
    if (!isLatest || autoPaused || sending || !msg.retryPrompt || triggeredRef.current) return;
    if (secondsLeft <= 0) {
      triggeredRef.current = true;
      onRetryNowRef.current();
      return;
    }
    const timer = window.setTimeout(() => {
      setSecondsLeft((prev) => Math.max(0, prev - 1));
    }, 1000);
    return () => window.clearTimeout(timer);
  }, [isLatest, autoPaused, sending, msg.retryPrompt, secondsLeft]);

  const progressPct = Math.max(
    0,
    Math.min(100, Math.round(((initialSeconds - secondsLeft) / initialSeconds) * 100))
  );

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="rate-limit-cooldown-card"
      className="min-w-0 flex-1 rounded-2xl border border-[#E9D5A1] dark:border-[#5C4924] bg-[#FFFBF2] dark:bg-[#231E15] px-5 py-4 space-y-3.5"
    >
      <div className="flex items-start gap-3">
        <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#FEF3C7] dark:bg-[#3F3116] text-[#B45309] dark:text-[#FCD34D]">
          <Clock className="h-4 w-4" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-[#78350F] dark:text-[#FDE68A]">
              {msg.errorTitle || 'AI Quota Cooldown'}
            </span>
            {typeof msg.retryAttempts === 'number' && msg.retryAttempts > 0 && (
              <span className="rounded-full bg-[#FEF3C7] dark:bg-[#3F3116] px-2.5 py-0.5 font-mono text-[11px] font-medium text-[#92400E] dark:text-[#FCD34D]">
                {msg.retryAttempts} automatic backoff {msg.retryAttempts === 1 ? 'retry' : 'retries'} ran
              </span>
            )}
          </div>
          <p className="text-sm leading-relaxed text-[#713F12] dark:text-[#F3E2BD] break-words">
            {msg.content}
          </p>
        </div>
      </div>

      {isLatest && msg.retryPrompt && (
        <div className="space-y-1.5 pl-11">
          <div className="flex items-center justify-between text-xs text-[#92400E] dark:text-[#FCD34D]">
            <span>
              {autoPaused
                ? 'Auto-retry paused — click Retry Now when ready'
                : secondsLeft > 0
                  ? `Auto-retrying automatically in ${secondsLeft}s...`
                  : 'Retrying now...'}
            </span>
            <span className="font-mono tabular-nums">{secondsLeft}s</span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-[#F3E4BE] dark:bg-[#3A2E17]">
            <div
              className="h-full rounded-full bg-[#D97706] dark:bg-[#F59E0B] transition-all duration-700"
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 pl-11">
        {msg.retryPrompt && (
          <button
            type="button"
            disabled={sending}
            onClick={() => {
              triggeredRef.current = true;
              onRetryNow();
            }}
            className="inline-flex items-center gap-1.5 rounded-full bg-[#B45309] dark:bg-[#D97706] px-4 py-1.5 text-xs font-medium text-white hover:bg-[#92400E] dark:hover:bg-[#B45309] disabled:opacity-50 transition-colors whitespace-nowrap shrink-0"
          >
            <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Retry Now</span>
          </button>
        )}

        {isLatest && msg.retryPrompt && secondsLeft > 0 && (
          <button
            type="button"
            disabled={sending}
            onClick={() => setAutoPaused((p) => !p)}
            className="inline-flex items-center gap-1.5 rounded-full border border-[#E5C989] dark:border-[#5C4924] bg-white dark:bg-[#2C2418] px-3.5 py-1.5 text-xs font-medium text-[#78350F] dark:text-[#FDE68A] hover:bg-[#FEF3C7]/60 dark:hover:bg-[#3A2E17] disabled:opacity-50 transition-colors whitespace-nowrap shrink-0"
          >
            {autoPaused ? (
              <>
                <Play className="h-3 w-3" aria-hidden="true" />
                <span>Resume Auto-Retry</span>
              </>
            ) : (
              <>
                <Pause className="h-3 w-3" aria-hidden="true" />
                <span>Pause Auto-Retry</span>
              </>
            )}
          </button>
        )}

        {currentModelChoice === 'hyper' && msg.retryPrompt && (
          <button
            type="button"
            disabled={sending}
            onClick={() => {
              triggeredRef.current = true;
              onSwitchStandardAndRetry();
            }}
            className="inline-flex items-center gap-1.5 rounded-full border border-[#DDE3EA] dark:border-[#3C4043] bg-white dark:bg-[#282A2C] px-3.5 py-1.5 text-xs font-medium text-[#1F1F1F] dark:text-[#E3E3E3] hover:bg-[#F0F4F9] dark:hover:bg-[#333537] disabled:opacity-50 transition-colors whitespace-nowrap shrink-0"
          >
            <Zap className="h-3.5 w-3.5 text-[#1A73E8] dark:text-[#8AB4F8]" aria-hidden="true" />
            <span>Switch to Standard (Fast)</span>
          </button>
        )}
      </div>
    </div>
  );
}

export function CommandView({
  sessionId,
  messages,
  mode,
  onModeChange,
  modelChoice,
  showHyperUpgradePrompt,
  onDismissHyperUpgradePrompt,
  fastMode,
  onToggleFastMode,
  debugLoop,
  onToggleDebugLoop,
  showTasks,
  onToggleShowTasks,
  memoryEnabled,
  onToggleMemory,
  memoryFacts,
  onAddMemoryFact,
  onDeleteMemoryFact,
  onClearMemoryFacts,
  skills,
  onOpenSkillsModal,
  suppressSlashPalette = false,
  customInstructionsActive,
  onOpenSettingsModal,
  contextDrawerOpen,
  onCloseContextDrawer,
  account,
  draftInput,
  onDraftInputChange,
  onSend,
  sending,
  liveTasks,
  streamingReply,
  actions,
  onApproveAction,
  onRejectAction,
  onQueueDraft,
  onQueueSaveToDrive,
  onPreviewHtml,
  onOpenArtifact,
  activeArtifactSourceMessageId,
  onNavigateApprovals,
  onNavigateTools,
  onNavigatePlans,
  onSignInGoogle,
  authBusy = false,
  toolStatus,
}: CommandViewProps) {
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [inputError, setInputError] = useState<string | null>(null);
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [slashDismissed, setSlashDismissed] = useState(false);
  const [slashActiveIndex, setSlashActiveIndex] = useState(0);
  const [composerMenuOpen, setComposerMenuOpen] = useState(false);
  const composerMenuRef = useRef<HTMLDivElement | null>(null);

  // Context drawer & message copy state
  const [newMemoryText, setNewMemoryText] = useState('');
  const [memoryBusy, setMemoryBusy] = useState(false);
  const [drawerTab, setDrawerTab] = useState<'memory' | 'workspace'>('memory');
  const [copiedMsgId, setCopiedMsgId] = useState<string | null>(null);

  // System Prompt Optimizer state
  const [optimizerOpen, setOptimizerOpen] = useState(false);
  const [optimizerFocus, setOptimizerFocus] = useState<PromptOptimizationFocus>('balanced');
  const [optimizerLoading, setOptimizerLoading] = useState(false);
  const [optimizerError, setOptimizerError] = useState<string | null>(null);
  const [optimizerResult, setOptimizerResult] = useState<PromptOptimizationResult | null>(null);
  const [optimizerRawSnapshot, setOptimizerRawSnapshot] = useState('');
  const optimizerReqIdRef = useRef(0);

  // Close + composer menu on outside click or Escape
  useEffect(() => {
    if (!composerMenuOpen) return;
    const handlePointerDown = (e: MouseEvent) => {
      if (composerMenuRef.current && !composerMenuRef.current.contains(e.target as Node)) {
        setComposerMenuOpen(false);
      }
    };
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setComposerMenuOpen(false);
    };
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleEsc);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleEsc);
    };
  }, [composerMenuOpen]);

  // Clear pending attachments, errors, and optimizer overlay when switching chats
  useEffect(() => {
    setAttachments([]);
    setInputError(null);
    setComposerMenuOpen(false);
    setOptimizerOpen(false);
    setOptimizerResult(null);
    setOptimizerError(null);
  }, [sessionId]);

  const handleCopyAssistantReply = async (msgId: string, text: string) => {
    const ok = await copyTextToClipboard(text);
    if (ok) {
      setCopiedMsgId(msgId);
      window.setTimeout(() => setCopiedMsgId(null), 1600);
    }
  };

  const handleUsePromptInComposer = (promptText: string) => {
    onDraftInputChange(promptText);
    window.requestAnimationFrame(() => {
      textareaRef.current?.focus();
    });
  };

  const safeMessages = Array.isArray(messages) ? messages : [];
  const safeActions = Array.isArray(actions) ? actions : [];
  const safeMemoryFacts = Array.isArray(memoryFacts) ? memoryFacts : [];
  const safeSkills = Array.isArray(skills) ? skills : [];
  const pendingActions = safeActions.filter((a) => a.status === 'pending');

  const slashQuery = detectSlashQuery(draftInput);
  const filteredSkills = slashQuery !== null ? filterSkills(safeSkills, slashQuery) : [];
  const showSlashPalette =
    !suppressSlashPalette && slashQuery !== null && !slashDismissed && filteredSkills.length > 0;

  useEffect(() => {
    setSlashDismissed(false);
    setSlashActiveIndex(0);
  }, [slashQuery]);

  const isPlus = account?.plan === 'plus';
  const isGuest = account?.authType === 'guest';
  const used = account?.usage?.used ?? 0;
  const limit =
    account?.usage?.limit ??
    (isGuest ? GUEST_WINDOW_MESSAGE_LIMIT : SIGNED_IN_WINDOW_MESSAGE_LIMIT);
  const resetCountdown = formatResetCountdown(account?.usage?.resetsAt);
  const guestLimitReached = !isPlus && isGuest && used >= limit;
  const isEmptyWelcome = safeMessages.length === 0 && !sending;

  // Auto-grow composer textarea smoothly from single-line pill up to 140px
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
  }, [draftInput, isEmptyWelcome]);

  // Smooth scroll on new messages; during streaming only follow when user is near the bottom
  useEffect(() => {
    if (!isEmptyWelcome) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [safeMessages.length, sending, isEmptyWelcome]);

  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el || isEmptyWelcome) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (distanceFromBottom < 180) {
      el.scrollTop = el.scrollHeight;
    }
  }, [streamingReply.length, liveTasks.length, isEmptyWelcome]);

  const ingestFiles = async (fileList: FileList | File[]) => {
    const incoming = Array.from(fileList);
    if (incoming.length === 0) return;

    setInputError(null);
    let currentCount = attachments.length;
    const added: ChatAttachment[] = [];

    for (const file of incoming) {
      const check = validateAttachmentCandidate({
        name: file.name || 'pasted-image.png',
        mimeType: file.type,
        size: file.size,
        existingCount: currentCount,
      });

      if (!check.ok) {
        setInputError(check.error);
        break;
      }

      try {
        if (check.kind === 'image' || check.isPdf) {
          const dataUrl = await readFileAsDataUrl(file);
          const commaIdx = dataUrl.indexOf(',');
          const base64 = commaIdx >= 0 ? dataUrl.slice(commaIdx + 1) : '';
          added.push({
            id: `att_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
            kind: check.kind,
            name: file.name || 'image.png',
            mimeType: file.type || (check.isPdf ? 'application/pdf' : 'image/png'),
            size: file.size,
            dataBase64: base64,
            previewUrl: check.kind === 'image' ? dataUrl : undefined,
          });
        } else {
          const text = await file.text();
          added.push({
            id: `att_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
            kind: 'file',
            name: file.name,
            mimeType: file.type || 'text/plain',
            size: file.size,
            textContent: text.slice(0, MAX_TEXT_FILE_CHARS),
          });
        }
        currentCount += 1;
      } catch (err) {
        setInputError(err instanceof Error ? err.message : `Failed to load "${file.name}".`);
      }
    }

    if (added.length > 0) {
      setAttachments((prev) => [...prev, ...added]);
    }
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = Array.from(e.clipboardData?.items ?? []);
    const pastedFiles = items
      .filter((item) => item.kind === 'file')
      .map((item) => item.getAsFile())
      .filter((f): f is File => Boolean(f));
    if (pastedFiles.length > 0) {
      e.preventDefault();
      void ingestFiles(pastedFiles);
    }
  };

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const trimmed = draftInput.trim();
    if (!trimmed && attachments.length === 0) {
      setInputError('Enter a prompt or attach a file/image first.');
      return;
    }
    if (sending) return;
    setInputError(null);
    const toSend = attachments;
    setAttachments([]);
    await onSend(trimmed, toSend);
  };

  const selectSkillIntoComposer = (skill: SkillDefinition) => {
    onDraftInputChange(`${skill.command} `);
    if (skill.mode !== 'auto') {
      onModeChange(skill.mode);
    }
    setSlashDismissed(true);
    window.requestAnimationFrame(() => textareaRef.current?.focus());
  };

  const runPromptOptimizer = async (
    rawText: string,
    targetFocus: PromptOptimizationFocus
  ) => {
    const trimmed = rawText.trim();
    if (!trimmed) {
      setInputError('Type a draft prompt first to optimize it for Gemini.');
      window.requestAnimationFrame(() => textareaRef.current?.focus());
      return;
    }

    const reqId = optimizerReqIdRef.current + 1;
    optimizerReqIdRef.current = reqId;
    setInputError(null);
    setComposerMenuOpen(false);
    setOptimizerRawSnapshot(trimmed);
    setOptimizerFocus(targetFocus);
    setOptimizerOpen(true);
    setOptimizerLoading(true);
    setOptimizerError(null);

    try {
      const recentHistory = safeMessages.slice(-4).map((m) => ({
        role: m.role,
        content: m.content,
      }));
      const optimized = await optimizeUserPrompt({
        message: trimmed,
        mode,
        focus: targetFocus,
        history: recentHistory,
      });
      if (optimizerReqIdRef.current !== reqId) return;
      setOptimizerResult(optimized);
    } catch (err) {
      if (optimizerReqIdRef.current !== reqId) return;
      setOptimizerError(
        err instanceof Error
          ? err.message
          : 'Could not optimize your prompt right now. Please try again.'
      );
    } finally {
      if (optimizerReqIdRef.current === reqId) {
        setOptimizerLoading(false);
      }
    }
  };

  const handleOpenOptimizer = () => {
    if (sending) return;
    void runPromptOptimizer(draftInput, optimizerFocus);
  };

  const handleChangeOptimizerFocus = (nextFocus: PromptOptimizationFocus) => {
    if (nextFocus === optimizerFocus && optimizerResult) return;
    const baseText = optimizerRawSnapshot || draftInput;
    void runPromptOptimizer(baseText, nextFocus);
  };

  const handleApplyOptimizedPrompt = (optimizedPrompt: string) => {
    onDraftInputChange(optimizedPrompt);
    setOptimizerOpen(false);
    setInputError(null);
    window.requestAnimationFrame(() => {
      textareaRef.current?.focus();
    });
  };

  const handleSendOptimizedPrompt = async (optimizedPrompt: string) => {
    const trimmed = optimizedPrompt.trim();
    if (!trimmed || sending) return;
    setOptimizerOpen(false);
    setInputError(null);
    const toSend = attachments;
    setAttachments([]);
    await onSend(trimmed, toSend);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'o') {
      e.preventDefault();
      handleOpenOptimizer();
      return;
    }

    if (showSlashPalette) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSlashActiveIndex((idx) => (idx + 1) % filteredSkills.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSlashActiveIndex((idx) => (idx - 1 + filteredSkills.length) % filteredSkills.length);
        return;
      }
      if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) {
        const picked = filteredSkills[slashActiveIndex] ?? filteredSkills[0];
        if (picked) {
          e.preventDefault();
          selectSkillIntoComposer(picked);
          return;
        }
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setSlashDismissed(true);
        return;
      }
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSubmit();
    }
  };

  const handleAddMemorySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newMemoryText.trim();
    if (!trimmed || memoryBusy) return;
    setMemoryBusy(true);
    try {
      await onAddMemoryFact(trimmed, 'preference');
      setNewMemoryText('');
    } finally {
      setMemoryBusy(false);
    }
  };

  const hasDraft = Boolean(draftInput.trim() || attachments.length > 0);
  const isTaskTabActive = mode !== 'auto';

  /** Floating White Rounded Pill Composer + Centered Chat/Task Toggle (Exact Reference Screenshot 3) */
  const renderComposer = (showChatTaskToggle = false) => (
    <form
      onSubmit={handleSubmit}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        if (e.dataTransfer?.files?.length) {
          void ingestFiles(e.dataTransfer.files);
        }
      }}
      className="w-full"
    >
      <div className="mx-auto max-w-[740px] space-y-3">
        {inputError && (
          <p className="px-3 text-center text-xs font-medium text-[#D93025] dark:text-[#F28B82]" role="alert">
            {inputError}
          </p>
        )}

        {/* Attached Files / Images Preview Strip */}
        {attachments.length > 0 && (
          <div className="flex flex-wrap justify-center gap-2 px-1">
            {attachments.map((att) => (
              <div
                key={att.id}
                className="inline-flex items-center gap-2 rounded-2xl border border-[#DDE3EA] dark:border-[#3C4043] bg-white/90 dark:bg-[#282A2C] pl-2.5 pr-2 py-1.5 text-xs shadow-xs"
              >
                {att.kind === 'image' && att.previewUrl ? (
                  <img
                    src={att.previewUrl}
                    alt={att.name}
                    className="h-7 w-7 rounded-lg object-cover"
                  />
                ) : (
                  <FileCode2 className="h-4 w-4 shrink-0 text-[#1A73E8] dark:text-[#8AB4F8]" />
                )}
                <div className="min-w-0">
                  <div className="max-w-[150px] truncate font-mono text-[11px] font-medium text-[#1F1F1F] dark:text-[#E3E3E3]">
                    {att.name}
                  </div>
                  <div className="font-mono text-[10px] text-[#5F6368] dark:text-[#9AA0A6]">
                    {formatBytes(att.size)}
                  </div>
                </div>
                <button
                  type="button"
                  aria-label={`Remove ${att.name}`}
                  onClick={() =>
                    setAttachments((prev) => prev.filter((item) => item.id !== att.id))
                  }
                  className="inline-flex h-5 w-5 items-center justify-center rounded-full text-[#5F6368] hover:bg-[#E1E5EA] dark:hover:bg-[#3C4043] hover:text-[#1F1F1F] dark:hover:text-white"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        )}

        {guestLimitReached && (
          <div
            role="status"
            className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#C2D4EE] dark:border-[#004A77] bg-white/90 dark:bg-[#004A77]/35 px-4 py-2.5 text-xs text-[#041E49] dark:text-[#C2E7FF] shadow-xs"
          >
            <div className="min-w-0 flex-1">
              <strong>
                Free Guest limit reached ({used}/{limit} msgs / {USAGE_WINDOW_HOURS}h
                {resetCountdown ? ` · resets in ${resetCountdown}` : ''}).
              </strong>{' '}
              Sign in with Google for {SIGNED_IN_WINDOW_MESSAGE_LIMIT} messages /{' '}
              {USAGE_WINDOW_HOURS} hours and Firebase Cloud sync.
            </div>
            {onSignInGoogle && (
              <button
                type="button"
                disabled={authBusy}
                onClick={() => void onSignInGoogle()}
                className="inline-flex items-center gap-1.5 rounded-full bg-[#1A73E8] px-3.5 py-1.5 text-xs font-medium text-white hover:bg-[#1557B0] disabled:opacity-50 transition-colors whitespace-nowrap shrink-0"
              >
                <LogIn className="h-3.5 w-3.5" aria-hidden="true" />
                <span>{authBusy ? 'Signing in...' : 'Sign in with Google'}</span>
              </button>
            )}
          </div>
        )}

        {/* Centered Floating Chat | Task Segmented Switcher (Exact Screenshot 3 Position & Styling) */}
        {showChatTaskToggle && (
          <div className="flex justify-center pb-0.5">
            <div
              role="tablist"
              aria-label="Conversation mode"
              className="inline-flex items-center gap-1 rounded-full p-1"
            >
              <button
                type="button"
                role="tab"
                aria-selected={!isTaskTabActive}
                onClick={() => onModeChange('auto')}
                className={`rounded-full px-5 py-2 text-[15px] transition-all ${
                  !isTaskTabActive
                    ? 'bg-white dark:bg-[#282A2C] font-medium text-[#1F1F1F] dark:text-[#F1F3F4] shadow-[0_2px_12px_rgba(26,115,232,0.1)]'
                    : 'font-normal text-[#1F1F1F]/80 dark:text-[#C4C7C5] hover:text-[#1F1F1F] dark:hover:text-white'
                }`}
              >
                Chat
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={isTaskTabActive}
                onClick={() => {
                  onModeChange('coding');
                  if (!showTasks) onToggleShowTasks();
                }}
                className={`rounded-full px-5 py-2 text-[15px] transition-all ${
                  isTaskTabActive
                    ? 'bg-white dark:bg-[#282A2C] font-medium text-[#1F1F1F] dark:text-[#F1F3F4] shadow-[0_2px_12px_rgba(26,115,232,0.1)]'
                    : 'font-normal text-[#1F1F1F]/80 dark:text-[#C4C7C5] hover:text-[#1F1F1F] dark:hover:text-white'
                }`}
              >
                Task
              </button>
            </div>
          </div>
        )}

        {/* Hidden File & Image Pickers */}
        <input
          ref={imageInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files?.length) void ingestFiles(e.target.files);
            e.target.value = '';
          }}
        />
        <input
          ref={fileInputRef}
          type="file"
          accept=".txt,.md,.html,.htm,.css,.js,.ts,.tsx,.jsx,.json,.csv,.xml,.svg,.py,.lua,.luau,.sql,.yaml,.yml,.pdf"
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files?.length) void ingestFiles(e.target.files);
            e.target.value = '';
          }}
        />

        {/* Floating White Rounded Pill Composer + Slash Skills Palette + '+' Actions Popover */}
        <div className="relative" ref={composerMenuRef}>
          {showSlashPalette && (
            <div
              role="listbox"
              aria-label="Skills command palette"
              className="absolute bottom-full left-0 right-0 z-30 mb-3 overflow-hidden rounded-3xl border border-[#DDE3EA] dark:border-[#333537] bg-white dark:bg-[#1E1F20] shadow-xl"
            >
              <div className="flex items-center justify-between border-b border-[#E8EDF4] dark:border-[#2E3033] bg-[#F8FAFD] dark:bg-[#252628] px-4 py-2.5 text-[11px] font-medium text-[#5F6368] dark:text-[#9AA0A6]">
                <span className="inline-flex items-center gap-1.5">
                  <Wand2 className="h-3.5 w-3.5 text-[#1A73E8] dark:text-[#8AB4F8]" />
                  Skills · Select a slash command
                </span>
                <button
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    onOpenSkillsModal();
                  }}
                  className="font-medium text-[#1A73E8] dark:text-[#8AB4F8] hover:underline"
                >
                  + Manage / New Skill
                </button>
              </div>
              <div className="max-h-64 overflow-y-auto p-1.5 space-y-0.5">
                {filteredSkills.map((skill, idx) => {
                  const active = idx === slashActiveIndex;
                  return (
                    <button
                      key={skill.id}
                      type="button"
                      role="option"
                      aria-selected={active}
                      onMouseEnter={() => setSlashActiveIndex(idx)}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        selectSkillIntoComposer(skill);
                      }}
                      className={`flex w-full items-start justify-between gap-3 rounded-2xl px-3.5 py-2 text-left transition-colors ${
                        active
                          ? 'bg-[#E8F0FE] dark:bg-[#004A77]/60'
                          : 'hover:bg-[#F0F4F9] dark:hover:bg-[#282A2C]'
                      }`}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <code className="font-mono text-xs font-semibold text-[#1A73E8] dark:text-[#C2E7FF]">
                            {skill.command}
                          </code>
                          <span className="text-xs font-semibold text-[#1F1F1F] dark:text-[#E3E3E3]">
                            {skill.name}
                          </span>
                        </div>
                        <p className="mt-0.5 truncate text-[11px] text-[#5F6368] dark:text-[#9AA0A6]">
                          {skill.description}
                        </p>
                      </div>
                      <span className="mt-0.5 font-mono text-[10px] uppercase text-[#5F6368] dark:text-[#9AA0A6] shrink-0">
                        {skill.mode}
                      </span>
                    </button>
                  );
                })}
              </div>
              <div className="flex items-center justify-between border-t border-[#E8EDF4] dark:border-[#2E3033] px-4 py-1.5 text-[10px] text-[#5F6368] dark:text-[#8E918F]">
                <span>↑↓ Navigate · Tab / Enter to insert · Esc to close</span>
                <span className="font-mono">{filteredSkills.length} matching</span>
              </div>
            </div>
          )}

          {/* '+' Floating Options Popover (All Attachments, Mode & Agent Switches neatly housed) */}
          {composerMenuOpen && (
            <div
              role="dialog"
              aria-label="Attachments and agent controls"
              className="absolute bottom-full left-0 z-30 mb-3 w-[300px] max-w-[calc(100vw-2rem)] overflow-hidden rounded-[24px] border border-[#E1E7F0] dark:border-[#333537] bg-white dark:bg-[#1E1F20] p-2 shadow-[0_14px_38px_rgba(15,23,42,0.16)] space-y-1.5"
            >
              {/* Quick Attachments & Skills */}
              <div className="space-y-0.5">
                <button
                  type="button"
                  disabled={sending}
                  onClick={() => {
                    setComposerMenuOpen(false);
                    imageInputRef.current?.click();
                  }}
                  className="flex w-full items-center gap-3 rounded-2xl px-3.5 py-2.5 text-left text-sm text-[#1F1F1F] dark:text-[#E3E3E3] hover:bg-[#F2F4F8] dark:hover:bg-[#282A2C] transition-colors"
                >
                  <ImagePlus className="h-4 w-4 text-[#1A73E8] dark:text-[#8AB4F8]" />
                  <span>Attach image</span>
                </button>
                <button
                  type="button"
                  disabled={sending}
                  onClick={() => {
                    setComposerMenuOpen(false);
                    fileInputRef.current?.click();
                  }}
                  className="flex w-full items-center gap-3 rounded-2xl px-3.5 py-2.5 text-left text-sm text-[#1F1F1F] dark:text-[#E3E3E3] hover:bg-[#F2F4F8] dark:hover:bg-[#282A2C] transition-colors"
                >
                  <Paperclip className="h-4 w-4 text-[#444746] dark:text-[#C4C7C5]" />
                  <span>Attach code or document</span>
                </button>
                <button
                  type="button"
                  disabled={sending}
                  onClick={() => {
                    setComposerMenuOpen(false);
                    onOpenSkillsModal();
                  }}
                  className="flex w-full items-center justify-between gap-3 rounded-2xl px-3.5 py-2.5 text-left text-sm text-[#1F1F1F] dark:text-[#E3E3E3] hover:bg-[#F2F4F8] dark:hover:bg-[#282A2C] transition-colors"
                >
                  <span className="inline-flex items-center gap-3">
                    <Wand2 className="h-4 w-4 text-[#1A73E8] dark:text-[#8AB4F8]" />
                    <span>Skills (/)</span>
                  </span>
                  <span className="font-mono text-[11px] text-[#5F6368] dark:text-[#9AA0A6]">
                    {safeSkills.length}
                  </span>
                </button>
                <button
                  type="button"
                  disabled={sending}
                  onClick={() => {
                    setComposerMenuOpen(false);
                    handleOpenOptimizer();
                  }}
                  className="flex w-full items-center justify-between gap-3 rounded-2xl px-3.5 py-2.5 text-left text-sm text-[#1F1F1F] dark:text-[#E3E3E3] hover:bg-[#F2F4F8] dark:hover:bg-[#282A2C] transition-colors"
                >
                  <span className="inline-flex items-center gap-3">
                    <SlidersHorizontal className="h-4 w-4 text-[#1A73E8] dark:text-[#8AB4F8]" />
                    <span>System Prompt Optimizer</span>
                  </span>
                  <span className="font-mono text-[10px] text-[#5F6368] dark:text-[#9AA0A6]">
                    ⇧⌘O
                  </span>
                </button>
              </div>

              <div className="border-t border-[#F0F4F9] dark:border-[#2E3033] pt-1.5 px-2">
                <div className="mb-1.5 px-1.5 text-[11px] font-medium text-[#5F6368] dark:text-[#9AA0A6]">
                  Assistant Mode
                </div>
                <div
                  className="grid grid-cols-3 gap-1 rounded-full bg-[#F0F4F9] dark:bg-[#282A2C] p-0.5"
                  role="tablist"
                  aria-label="Assistant mode"
                >
                  {(
                    [
                      { id: 'auto', label: 'Auto', icon: Sparkles },
                      { id: 'coding', label: 'Coding', icon: Code2 },
                      { id: 'business', label: 'Business', icon: Briefcase },
                    ] as const
                  ).map((tab) => {
                    const Icon = tab.icon;
                    const active = mode === tab.id;
                    return (
                      <button
                        key={tab.id}
                        type="button"
                        role="tab"
                        aria-selected={active}
                        onClick={() => onModeChange(tab.id)}
                        className={`inline-flex items-center justify-center gap-1 rounded-full px-2 py-1.5 text-xs font-medium transition-colors ${
                          active
                            ? 'bg-white dark:bg-[#131314] text-[#1F1F1F] dark:text-[#F1F3F4] shadow-xs'
                            : 'text-[#5F6368] dark:text-[#9AA0A6] hover:text-[#1F1F1F] dark:hover:text-white'
                        }`}
                      >
                        <Icon className="h-3 w-3" aria-hidden="true" />
                        <span>{tab.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Agent Runtime Switches */}
              <div className="border-t border-[#F0F4F9] dark:border-[#2E3033] pt-1.5 space-y-0.5">
                <button
                  type="button"
                  role="switch"
                  aria-checked={fastMode}
                  onClick={onToggleFastMode}
                  disabled={modelChoice === 'hyper'}
                  className="flex w-full items-center justify-between rounded-2xl px-3.5 py-2 text-xs font-medium text-[#1F1F1F] dark:text-[#E3E3E3] hover:bg-[#F2F4F8] dark:hover:bg-[#282A2C] disabled:opacity-50"
                >
                  <span className="inline-flex items-center gap-2.5">
                    <Zap className="h-3.5 w-3.5 text-[#1A73E8] dark:text-[#8AB4F8]" />
                    <span>Fast Mode</span>
                  </span>
                  <span className={`font-mono text-[11px] uppercase ${fastMode ? 'text-[#1A73E8] dark:text-[#8AB4F8]' : 'text-[#5F6368]'}`}>
                    {fastMode ? 'On' : 'Off'}
                  </span>
                </button>

                <button
                  type="button"
                  role="switch"
                  aria-checked={debugLoop}
                  onClick={onToggleDebugLoop}
                  className="flex w-full items-center justify-between rounded-2xl px-3.5 py-2 text-xs font-medium text-[#1F1F1F] dark:text-[#E3E3E3] hover:bg-[#F2F4F8] dark:hover:bg-[#282A2C]"
                >
                  <span className="inline-flex items-center gap-2.5">
                    <Bug className="h-3.5 w-3.5 text-[#1A73E8] dark:text-[#8AB4F8]" />
                    <span>Debug Loop</span>
                  </span>
                  <span className={`font-mono text-[11px] uppercase ${debugLoop ? 'text-[#1A73E8] dark:text-[#8AB4F8]' : 'text-[#5F6368]'}`}>
                    {debugLoop ? 'On' : 'Off'}
                  </span>
                </button>

                <button
                  type="button"
                  role="switch"
                  aria-checked={showTasks}
                  onClick={onToggleShowTasks}
                  className="flex w-full items-center justify-between rounded-2xl px-3.5 py-2 text-xs font-medium text-[#1F1F1F] dark:text-[#E3E3E3] hover:bg-[#F2F4F8] dark:hover:bg-[#282A2C]"
                >
                  <span className="inline-flex items-center gap-2.5">
                    <ListChecks className="h-3.5 w-3.5 text-[#1A73E8] dark:text-[#8AB4F8]" />
                    <span>AI Tasks</span>
                  </span>
                  <span className={`font-mono text-[11px] uppercase ${showTasks ? 'text-[#1A73E8] dark:text-[#8AB4F8]' : 'text-[#5F6368]'}`}>
                    {showTasks ? 'On' : 'Off'}
                  </span>
                </button>

                <button
                  type="button"
                  role="switch"
                  aria-checked={memoryEnabled}
                  onClick={onToggleMemory}
                  className="flex w-full items-center justify-between rounded-2xl px-3.5 py-2 text-xs font-medium text-[#1F1F1F] dark:text-[#E3E3E3] hover:bg-[#F2F4F8] dark:hover:bg-[#282A2C]"
                >
                  <span className="inline-flex items-center gap-2.5">
                    <Brain className="h-3.5 w-3.5 text-[#1A73E8] dark:text-[#8AB4F8]" />
                    <span>Memory ({safeMemoryFacts.length})</span>
                  </span>
                  <span className={`font-mono text-[11px] uppercase ${memoryEnabled ? 'text-[#1A73E8] dark:text-[#8AB4F8]' : 'text-[#5F6368]'}`}>
                    {memoryEnabled ? 'On' : 'Off'}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setComposerMenuOpen(false);
                    onOpenSettingsModal();
                  }}
                  className="flex w-full items-center justify-between rounded-2xl px-3.5 py-2 text-xs font-medium text-[#1F1F1F] dark:text-[#E3E3E3] hover:bg-[#F2F4F8] dark:hover:bg-[#282A2C]"
                >
                  <span className="inline-flex items-center gap-2.5">
                    <Sliders className="h-3.5 w-3.5 text-[#5F6368] dark:text-[#9AA0A6]" />
                    <span>Custom Instructions</span>
                  </span>
                  <span className={`font-mono text-[11px] uppercase ${customInstructionsActive ? 'text-[#188038] dark:text-[#81C995]' : 'text-[#5F6368]'}`}>
                    {customInstructionsActive ? 'On' : 'Edit'}
                  </span>
                </button>
              </div>
            </div>
          )}

          {/* Main Floating White Rounded Pill Bar */}
          <div
            className={`flex items-center gap-2 rounded-[36px] border px-3 py-2.5 transition-all ${
              dragOver
                ? 'border-[#1A73E8] bg-[#E8F0FE] dark:bg-[#1E293B] shadow-lg'
                : 'border-white/95 dark:border-[#333537] bg-white dark:bg-[#1E1F20] shadow-[0_8px_30px_rgba(26,115,232,0.13),0_2px_8px_rgba(15,23,42,0.04)] dark:shadow-[0_8px_28px_rgba(0,0,0,0.45)] focus-within:border-[#C2D8FB] dark:focus-within:border-[#4D5156]'
            }`}
          >
            {/* Left '+' Button with Signature Tiny Blue Dot */}
            <button
              type="button"
              disabled={sending}
              onClick={() => setComposerMenuOpen((o) => !o)}
              aria-expanded={composerMenuOpen}
              aria-label="Attachments, skills and agent options"
              title="Attach image/file, switch mode, or toggle agent controls"
              className="relative inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-[#1F1F1F] dark:text-[#E3E3E3] hover:bg-[#F2F4F8] dark:hover:bg-[#282A2C] disabled:opacity-50 transition-colors"
            >
              <Plus className="h-[22px] w-[22px]" strokeWidth={1.8} />
              <span
                className="pointer-events-none absolute right-2 top-2 h-2 w-2 rounded-full bg-[#4285F4] ring-2 ring-white dark:ring-[#1E1F20]"
                aria-hidden="true"
              />
            </button>

            <label htmlFor="agent-prompt" className="sr-only">
              Message IND AGENT
            </label>
            <textarea
              ref={textareaRef}
              id="agent-prompt"
              rows={1}
              value={draftInput}
              onChange={(e) => {
                onDraftInputChange(e.target.value);
                if (inputError) setInputError(null);
              }}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              placeholder="Try / for more"
              className="min-h-[28px] max-h-[140px] flex-1 resize-none bg-transparent py-1.5 text-[16px] leading-snug text-[#1F1F1F] dark:text-[#E3E3E3] placeholder:text-[#747775] dark:placeholder:text-[#9AA0A6] focus:outline-none"
            />

            {/* System Prompt Optimizer Trigger */}
            <button
              type="button"
              disabled={sending}
              onClick={handleOpenOptimizer}
              data-testid="composer-optimize-btn"
              aria-label="Optimize prompt for Gemini"
              title={
                draftInput.trim()
                  ? 'Optimize prompt for Gemini (Ctrl+Shift+O)'
                  : 'Type a draft prompt to optimize it for Gemini'
              }
              className={`inline-flex shrink-0 items-center justify-center gap-1.5 rounded-full transition-colors disabled:opacity-50 whitespace-nowrap ${
                draftInput.trim().length > 0
                  ? 'h-10 px-3 sm:px-3.5 bg-[#F0F4F9] dark:bg-[#282A2C] text-[#1A73E8] dark:text-[#8AB4F8] hover:bg-[#E4ECF7] dark:hover:bg-[#333537] text-xs font-medium'
                  : 'h-10 w-10 text-[#5F6368] dark:text-[#9AA0A6] hover:bg-[#F2F4F8] dark:hover:bg-[#282A2C] hover:text-[#1F1F1F] dark:hover:text-[#E3E3E3]'
              }`}
            >
              {optimizerLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <SlidersHorizontal className="h-[17px] w-[17px]" strokeWidth={1.8} aria-hidden="true" />
              )}
              {draftInput.trim().length > 0 && (
                <span className="hidden sm:inline">Optimize</span>
              )}
            </button>

            {/* Right Quick Skills / Slash Button */}
            <button
              type="button"
              disabled={sending}
              onClick={() => {
                if (!draftInput.startsWith('/')) {
                  onDraftInputChange('/');
                  textareaRef.current?.focus();
                } else {
                  onOpenSkillsModal();
                }
              }}
              aria-label="Browse slash skills"
              title="Insert / for Skills"
              className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[#1F1F1F] dark:text-[#E3E3E3] hover:bg-[#F2F4F8] dark:hover:bg-[#282A2C] disabled:opacity-50 transition-colors"
            >
              <Wand2 className="h-[19px] w-[19px]" strokeWidth={1.8} />
            </button>

            {/* Signature Soft Ice-Blue Circular Primary Send Button */}
            <button
              type="submit"
              disabled={sending}
              aria-label="Send"
              className={`inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition-colors ${
                hasDraft && !sending
                  ? 'bg-[#1A73E8] text-white hover:bg-[#1557B0]'
                  : 'bg-[#DCEEFF] dark:bg-[#004A77] text-[#1F1F1F] dark:text-[#C2E7FF] hover:bg-[#CCE4FF] dark:hover:bg-[#005B94]'
              }`}
            >
              {sending ? (
                <Loader2 className="h-[18px] w-[18px] animate-spin" />
              ) : hasDraft ? (
                <ArrowUp className="h-5 w-5" strokeWidth={2.2} />
              ) : (
                <SoundWaveActionIcon />
              )}
            </button>
          </div>
        </div>
      </div>
    </form>
  );

  return (
    <div className="relative flex h-full min-h-0 flex-1 bg-white dark:bg-[#131314]">
      {/* Main Centered Conversation Canvas */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Locked IND HYPER CODING MODEL Upgrade Banner */}
        {showHyperUpgradePrompt && !isPlus && (
          <div
            role="region"
            aria-label="IND HYPER CODING MODEL Plus requirement"
            className="mx-auto mt-2 w-full max-w-[740px] px-4"
          >
            <div className="flex flex-wrap items-start justify-between gap-3 rounded-2xl border border-[#C2D4EE] dark:border-[#004A77] bg-[#F0F4F9] dark:bg-[#1E1F20] px-4 py-3">
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex items-center gap-2 text-xs font-semibold text-[#041E49] dark:text-[#C2E7FF]">
                  <Lock className="h-3.5 w-3.5 shrink-0 text-[#1A73E8] dark:text-[#8AB4F8]" />
                  <span>IND HYPER CODING MODEL is available on IND AGENT Plus</span>
                </div>
                <p className="text-xs leading-relaxed text-[#444746] dark:text-[#C4C7C5]">
                  Unlocks deeper step-by-step planning, automatic bug self-review pass, multi-file
                  ZIP downloads, 100-message context, and unlimited messages for ₹200 / month via UPI / FamPay.
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    onDismissHyperUpgradePrompt();
                    onNavigatePlans();
                  }}
                  className="rounded-full bg-[#1A73E8] px-3.5 py-1.5 text-xs font-medium text-white hover:bg-[#1557B0] transition-colors whitespace-nowrap shrink-0"
                >
                  Upgrade to Plus · ₹200/mo
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onDismissHyperUpgradePrompt();
                    onNavigatePlans();
                  }}
                  className="rounded-full border border-[#DDE3EA] dark:border-[#3C4043] bg-white dark:bg-[#282A2C] px-3.5 py-1.5 text-xs font-medium text-[#1F1F1F] dark:text-[#E3E3E3] hover:bg-[#F8FAFD] transition-colors whitespace-nowrap shrink-0"
                >
                  Compare Plans
                </button>
                <button
                  type="button"
                  aria-label="Dismiss upgrade prompt"
                  onClick={onDismissHyperUpgradePrompt}
                  className="inline-flex h-7 w-7 items-center justify-center rounded-full text-[#5F6368] hover:bg-[#DDE3EA]/70 dark:hover:bg-[#333537]"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          </div>
        )}

        {isEmptyWelcome ? (
          /* Airy White-to-Ice-Blue Ambient Welcome Stage (Exact Reference Screenshot 3) */
          <div className="relative flex flex-1 flex-col overflow-y-auto bg-[radial-gradient(ellipse_140%_62%_at_50%_100%,#CCE6FF_0%,#E3F1FF_38%,#F4F9FF_62%,#FFFFFF_84%)] dark:bg-[radial-gradient(ellipse_140%_58%_at_50%_100%,#0F223D_0%,#111B2B_40%,#131314_78%)] px-4 sm:px-6 pt-6 pb-6 sm:pb-10">
            <div className="mx-auto flex w-full max-w-[740px] flex-1 flex-col justify-end gap-8 sm:gap-10">
              {/* 3 Clean Borderless Prompt Suggestion Rows (No Boxed Cards) */}
              <div className="mx-auto w-full max-w-[540px] space-y-2.5 sm:space-y-3">
                {SUGGESTION_PROMPTS.map((item) => (
                  <button
                    key={item.title}
                    type="button"
                    onClick={() => {
                      onModeChange(item.mode);
                      onDraftInputChange(item.prompt);
                      textareaRef.current?.focus();
                    }}
                    className="group flex w-full items-center gap-4 rounded-2xl px-3.5 py-2.5 text-left transition-colors hover:bg-black/[0.04] dark:hover:bg-white/[0.06]"
                  >
                    <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center text-[#1F1F1F] dark:text-[#E3E3E3]">
                      {item.icon === 'user' ? (
                        <User className="h-[20px] w-[20px]" strokeWidth={1.7} aria-hidden="true" />
                      ) : item.icon === 'briefcase' ? (
                        <Briefcase className="h-[20px] w-[20px]" strokeWidth={1.7} aria-hidden="true" />
                      ) : (
                        <Code2 className="h-[20px] w-[20px]" strokeWidth={1.7} aria-hidden="true" />
                      )}
                    </span>
                    <span className="truncate text-[16px] font-normal text-[#1F1F1F] dark:text-[#E3E3E3] group-hover:text-[#1A73E8] dark:group-hover:text-[#8AB4F8] transition-colors">
                      {item.title}
                    </span>
                  </button>
                ))}
              </div>

              {/* Centered Chat | Task Switcher + Floating White Pill Composer */}
              <div className="w-full pt-1">
                {renderComposer(true)}
              </div>
            </div>
          </div>
        ) : (
          /* Active Conversation Stream + Bottom-Pinned Gemini Composer */
          <>
            <div
              ref={scrollContainerRef}
              className="flex-1 overflow-y-auto px-4 sm:px-6 pt-6 pb-8"
            >
              <div className="mx-auto max-w-[820px] space-y-8">
                {safeMessages.map((msg) => {
                  const actionIds = Array.isArray(msg.actionIds) ? msg.actionIds : [];
                  const msgActions = actionIds
                    .map((id) => safeActions.find((a) => a.id === id))
                    .filter((a): a is PendingAction => Boolean(a));
                  const toolsUsed = Array.isArray(msg.toolsUsed) ? msg.toolsUsed : [];
                  const injectionAlerts = Array.isArray(msg.injectionAlerts)
                    ? msg.injectionAlerts
                    : [];
                  const msgAttachments = Array.isArray(msg.attachments) ? msg.attachments : [];
                  const msgTasks = Array.isArray(msg.tasks) ? msg.tasks : [];

                  if (msg.role === 'user') {
                    return (
                      <div key={msg.id} className="flex justify-end">
                        <div className="max-w-[82%] rounded-3xl rounded-tr-md bg-[#E9EEF6] dark:bg-[#282A2C] px-5 py-3.5 text-[15px] leading-relaxed text-[#1F1F1F] dark:text-[#E3E3E3] space-y-2.5">
                          {msgAttachments.length > 0 && (
                            <div className="flex flex-wrap gap-2">
                              {msgAttachments.map((att) => (
                                <div
                                  key={att.id}
                                  className="flex items-center gap-2 rounded-xl border border-[#DDE3EA] dark:border-[#3C4043] bg-white/80 dark:bg-[#1E1F20] px-2.5 py-1.5 text-xs"
                                >
                                  {att.kind === 'image' && att.previewUrl ? (
                                    <img
                                      src={att.previewUrl}
                                      alt={att.name}
                                      className="h-8 w-8 rounded-lg object-cover"
                                    />
                                  ) : (
                                    <FileCode2 className="h-3.5 w-3.5 shrink-0 text-[#1A73E8] dark:text-[#8AB4F8]" />
                                  )}
                                  <div className="min-w-0">
                                    <div className="max-w-[160px] truncate font-mono text-[11px]">
                                      {att.name}
                                    </div>
                                    <div className="font-mono text-[10px] text-[#5F6368] dark:text-[#9AA0A6]">
                                      {formatBytes(att.size)}
                                    </div>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                          {msg.skillCommand && (
                            <div className="inline-flex items-center gap-1 rounded-full bg-[#D3E3FD] dark:bg-[#004A77] px-2.5 py-0.5 font-mono text-[11px] font-semibold text-[#041E49] dark:text-[#C2E7FF]">
                              <Wand2 className="h-3 w-3" aria-hidden="true" />
                              <span>{msg.skillCommand}</span>
                            </div>
                          )}
                          {msg.content && (
                            <p className="whitespace-pre-wrap break-words">{msg.content}</p>
                          )}
                        </div>
                      </div>
                    );
                  }

                  if (msg.error) {
                    const isLatestMessage = safeMessages[safeMessages.length - 1]?.id === msg.id;
                    const isRateLimited =
                      msg.errorCode === 'RATE_LIMITED' ||
                      /rate limit|quota|cooldown|429/i.test(msg.errorTitle ?? '');

                    if (isRateLimited) {
                      return (
                        <div key={msg.id} className="flex items-start gap-3.5">
                          <IndSparkMark />
                          <RateLimitCooldownCard
                            msg={msg}
                            isLatest={isLatestMessage}
                            sending={sending}
                            currentModelChoice={modelChoice}
                            onRetryNow={() => {
                              if (msg.retryPrompt) {
                                void onSend(msg.retryPrompt, undefined, {
                                  replaceErrorMessageId: msg.id,
                                });
                              }
                            }}
                            onSwitchStandardAndRetry={() => {
                              if (msg.retryPrompt) {
                                void onSend(msg.retryPrompt, undefined, {
                                  modelChoiceOverride: 'standard',
                                  replaceErrorMessageId: msg.id,
                                });
                              }
                            }}
                          />
                        </div>
                      );
                    }

                    return (
                      <div key={msg.id} className="flex items-start gap-3.5">
                        <IndSparkMark />
                        <div
                          role="alert"
                          className="min-w-0 flex-1 rounded-2xl border border-[#F5C2C0] dark:border-[#5C2B29] bg-[#FCE8E6]/70 dark:bg-[#3B1E1D] px-5 py-4 space-y-3"
                        >
                          <div className="flex items-start gap-2.5">
                            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-[#D93025] dark:text-[#F28B82]" />
                            <div className="min-w-0 flex-1 space-y-1">
                              <div className="text-xs font-semibold text-[#A50E0E] dark:text-[#F6AEA9]">
                                {msg.errorTitle || 'Request Error'}
                              </div>
                              <p className="text-sm leading-relaxed text-[#7F1D1D] dark:text-[#FCE8E6] break-words">
                                {msg.content}
                              </p>
                            </div>
                          </div>
                          <div className="flex flex-wrap items-center gap-2 pl-6">
                            {msg.retryPrompt && (
                              <button
                                type="button"
                                disabled={sending}
                                onClick={() =>
                                  void onSend(msg.retryPrompt!, undefined, {
                                    replaceErrorMessageId: msg.id,
                                  })
                                }
                                className="inline-flex items-center gap-1.5 rounded-full bg-[#D93025] px-3.5 py-1.5 text-xs font-medium text-white hover:bg-[#B3261E] disabled:opacity-50 transition-colors whitespace-nowrap shrink-0"
                              >
                                <RotateCcw className="h-3.5 w-3.5" />
                                Retry
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={onNavigateTools}
                              className="rounded-full border border-[#F5C2C0] dark:border-[#6C3432] bg-white dark:bg-[#282A2C] px-3.5 py-1.5 text-xs font-medium text-[#A50E0E] dark:text-[#F6AEA9] hover:bg-[#FCE8E6] transition-colors whitespace-nowrap shrink-0"
                            >
                              Check Tools
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  }

                  return (
                    <div key={msg.id} className="space-y-4">
                      <div className="flex items-start gap-3.5">
                        <div className="pt-0.5">
                          <IndSparkMark />
                        </div>
                        <div className="min-w-0 flex-1 space-y-3">
                          {/* Quiet Gemini metadata row */}
                          <div className="flex flex-wrap items-center gap-2 text-xs text-[#5F6368] dark:text-[#9AA0A6]">
                            <span className="font-semibold text-[#1F1F1F] dark:text-[#E3E3E3]">
                              IND AGENT
                            </span>
                            <span aria-hidden="true">·</span>
                            <span>
                              {msg.modelLabel ||
                                (msg.modelChoice === 'hyper'
                                  ? 'IND HYPER CODING MODEL'
                                  : msg.fastMode
                                    ? 'Standard (Fast)'
                                    : 'Standard Coding Model')}
                            </span>
                            {msg.elapsedMs !== undefined && (
                              <>
                                <span aria-hidden="true">·</span>
                                <span className="font-mono tabular-nums">
                                  {formatDuration(msg.elapsedMs)}
                                </span>
                              </>
                            )}
                            {msg.codeVerification && msg.codeVerification.filesChecked > 0 && (
                              <>
                                <span aria-hidden="true">·</span>
                                <span
                                  className={`font-medium ${
                                    msg.codeVerification.passed
                                      ? 'text-[#188038] dark:text-[#81C995]'
                                      : 'text-[#B06000] dark:text-[#FDD663]'
                                  }`}
                                >
                                  {msg.codeVerification.passed
                                    ? msg.codeVerification.issuesFixed > 0
                                      ? `Auto-debugged (${msg.codeVerification.passesRun} loops · 0 errors)`
                                      : `Verified (${msg.codeVerification.filesChecked} file${msg.codeVerification.filesChecked === 1 ? '' : 's'} · 0 errors)`
                                    : `${msg.codeVerification.remainingIssues} quality note${msg.codeVerification.remainingIssues === 1 ? '' : 's'}`}
                                </span>
                              </>
                            )}
                            {toolsUsed.length > 0 && (
                              <>
                                <span aria-hidden="true">·</span>
                                <span className="font-mono text-[11px]">
                                  {Array.from(new Set(toolsUsed)).join(', ')}
                                </span>
                              </>
                            )}
                          </div>

                          {showTasks && msgTasks.length > 0 && (
                            <TaskTimeline tasks={msgTasks} elapsedMs={msg.elapsedMs} />
                          )}

                          {injectionAlerts.length > 0 && (
                            <div className="flex items-start gap-2.5 rounded-2xl border border-[#F5C2C0] bg-[#FCE8E6]/70 dark:bg-[#3B1E1D] px-4 py-3 text-xs text-[#A50E0E] dark:text-[#F6AEA9]">
                              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                              <div>
                                <div className="font-semibold">
                                  Prompt injection detected in external content — ignored
                                </div>
                                <ul className="mt-1 list-disc pl-4 space-y-0.5">
                                  {injectionAlerts.map((alert, i) => (
                                    <li key={i}>
                                      {alert.source}:{' '}
                                      {(Array.isArray(alert.matches) ? alert.matches : []).join(', ')}
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            </div>
                          )}

                          <MessageRenderer
                            content={typeof msg.content === 'string' ? msg.content : ''}
                            plan={account?.plan ?? 'free'}
                            isActiveArtifact={Boolean(
                              activeArtifactSourceMessageId &&
                                activeArtifactSourceMessageId === msg.id
                            )}
                            onPreviewHtml={onPreviewHtml}
                            onOpenArtifact={(payload) =>
                              onOpenArtifact({ ...payload, sourceMessageId: msg.id })
                            }
                            onUsePrompt={handleUsePromptInComposer}
                            onNavigatePlans={onNavigatePlans}
                            onQueueSaveToDrive={(file) => {
                              void onQueueSaveToDrive(file);
                            }}
                            onQueueDraft={
                              msgActions.some(
                                (a) =>
                                  a.type === 'gmail_create_draft' || a.type === 'gmail_send_email'
                              )
                                ? undefined
                                : (draft) => {
                                    void onQueueDraft(draft);
                                  }
                            }
                          />

                          {/* Live Grounded Web Sources Chips */}
                          {Array.isArray(msg.webSources) &&
                            msg.webSources.length > 0 &&
                            (() => {
                              const safeSources = msg.webSources
                                .map((src) => ({
                                  title: src.title,
                                  href: sanitizeExternalUrl(src.uri),
                                }))
                                .filter(
                                  (src): src is { title: string; href: string } =>
                                    Boolean(src.href)
                                )
                                .slice(0, 8);
                              if (safeSources.length === 0) return null;
                              return (
                                <div className="rounded-2xl border border-[#E1E7F0] dark:border-[#2E3033] bg-[#F8FAFD] dark:bg-[#1A1B1D] px-3.5 py-2.5 space-y-2">
                                  <div className="flex items-center gap-1.5 text-[11px] font-medium text-[#5F6368] dark:text-[#9AA0A6]">
                                    <Globe className="h-3.5 w-3.5 text-[#1A73E8] dark:text-[#8AB4F8]" />
                                    <span>
                                      Web Sources ({safeSources.length})
                                    </span>
                                  </div>
                                  <div className="flex flex-wrap gap-1.5">
                                    {safeSources.map((src, idx) => (
                                      <a
                                        key={`${src.href}-${idx}`}
                                        href={src.href}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="inline-flex max-w-[240px] items-center gap-1.5 rounded-full border border-[#DDE3EA] dark:border-[#333537] bg-white dark:bg-[#232528] px-2.5 py-1 text-[11px] font-medium text-[#1F1F1F] dark:text-[#E3E3E3] hover:border-[#1A73E8] dark:hover:border-[#8AB4F8] hover:text-[#1A73E8] dark:hover:text-[#8AB4F8] transition-colors"
                                      >
                                        <span className="truncate">{src.title}</span>
                                        <ExternalLink className="h-2.5 w-2.5 shrink-0 opacity-65" />
                                      </a>
                                    ))}
                                  </div>
                                </div>
                              );
                            })()}

                          {/* Subtle Gemini/Claude Action Strip */}
                          <div className="flex flex-wrap items-center gap-2 pt-1">
                            <button
                              type="button"
                              onClick={() =>
                                void handleCopyAssistantReply(
                                  msg.id,
                                  typeof msg.content === 'string' ? msg.content : ''
                                )
                              }
                              className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium text-[#5F6368] dark:text-[#9AA0A6] hover:bg-[#F0F4F9] dark:hover:bg-[#282A2C] hover:text-[#1F1F1F] dark:hover:text-[#E3E3E3] transition-colors"
                              aria-label="Copy full response"
                            >
                              {copiedMsgId === msg.id ? (
                                <>
                                  <Check className="h-3.5 w-3.5 text-[#188038] dark:text-[#81C995]" />
                                  <span>Copied</span>
                                </>
                              ) : (
                                <>
                                  <Copy className="h-3.5 w-3.5" />
                                  <span>Copy response</span>
                                </>
                              )}
                            </button>
                          </div>

                          {/* Contextual Smart Follow-Up Chips on Latest Assistant Reply */}
                          {!sending &&
                            safeMessages[safeMessages.length - 1]?.id === msg.id &&
                            (() => {
                              const prevUserMsg = [...safeMessages]
                                .slice(0, -1)
                                .reverse()
                                .find((m) => m.role === 'user');
                              const followUps = buildFollowUpSuggestions(
                                typeof msg.content === 'string' ? msg.content : '',
                                typeof prevUserMsg?.content === 'string' ? prevUserMsg.content : ''
                              );
                              if (followUps.length === 0) return null;
                              return (
                                <div className="flex flex-wrap items-center gap-2 pt-1">
                                  {followUps.map((sug) => (
                                    <button
                                      key={sug.label}
                                      type="button"
                                      onClick={() => void onSend(sug.prompt)}
                                      className="inline-flex items-center gap-1.5 rounded-full border border-[#DDE3EA] dark:border-[#333537] bg-[#F8FAFD] dark:bg-[#1E1F20] px-3.5 py-1.5 text-xs font-medium text-[#444746] dark:text-[#C4C7C5] hover:border-[#1A73E8] dark:hover:border-[#8AB4F8] hover:text-[#1A73E8] dark:hover:text-[#8AB4F8] hover:bg-[#E8F0FE]/40 dark:hover:bg-[#004A77]/30 transition-colors"
                                    >
                                      <CornerDownRight className="h-3 w-3 shrink-0 opacity-70" />
                                      <span>{sug.label}</span>
                                    </button>
                                  ))}
                                </div>
                              );
                            })()}
                        </div>
                      </div>

                      {msgActions.length > 0 && (
                        <div className="space-y-3 pl-0 sm:pl-10">
                          {msgActions.map((act) => (
                            <ActionCard
                              key={act.id}
                              action={act}
                              onApprove={onApproveAction}
                              onReject={onRejectAction}
                              compact
                            />
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}

                {/* Live Streaming Response */}
                {sending && (
                  <div className="flex items-start gap-3.5">
                    <div className="pt-0.5">
                      <IndSparkMark spinning />
                    </div>
                    <div className="min-w-0 flex-1 space-y-3">
                      <div className="flex items-center gap-2 text-xs text-[#5F6368] dark:text-[#9AA0A6]">
                        <span className="font-semibold text-[#1F1F1F] dark:text-[#E3E3E3]">
                          IND AGENT
                        </span>
                        <span aria-hidden="true">·</span>
                        <span className="text-[#1A73E8] dark:text-[#8AB4F8]">
                          {modelChoice === 'hyper'
                            ? 'IND HYPER CODING MODEL'
                            : fastMode
                              ? 'Streaming'
                              : 'Deep reasoning'}
                        </span>
                      </div>

                      {showTasks && liveTasks.length > 0 && (
                        <TaskTimeline tasks={liveTasks} live />
                      )}

                      {streamingReply ? (
                        <MessageRenderer
                          content={streamingReply}
                          plan={account?.plan ?? 'free'}
                          isStreaming
                          onPreviewHtml={onPreviewHtml}
                          onUsePrompt={handleUsePromptInComposer}
                          onNavigatePlans={onNavigatePlans}
                        />
                      ) : (
                        !showTasks && (
                          <p className="text-sm text-[#5F6368] dark:text-[#9AA0A6]">
                            Thinking through your request...
                          </p>
                        )
                      )}
                    </div>
                  </div>
                )}

                <div ref={bottomRef} />
              </div>
            </div>

            {/* Bottom-Pinned Floating Pill Composer over Subtle Ice-Blue Ambient Wash */}
            <div className="shrink-0 bg-gradient-to-t from-[#DCEEFF]/80 via-[#F2F8FF]/90 to-white/0 dark:from-[#0D1A2B]/90 dark:via-[#131314]/90 dark:to-transparent px-4 sm:px-6 pt-3 pb-5">
              {renderComposer(false)}
            </div>
          </>
        )}
      </div>

      {/* Slide-Over Context Drawer (Chat Memory, Approval Queue, Status & Safety) */}
      {contextDrawerOpen && (
        <div
          className="fixed inset-0 z-40 flex justify-end"
          role="dialog"
          aria-modal="true"
          aria-label="Workspace memory and queue"
        >
          <div
            className="fixed inset-0 bg-black/25 dark:bg-black/50"
            onClick={onCloseContextDrawer}
          />
          <aside className="relative z-10 flex h-full w-[340px] max-w-[90vw] flex-col border-l border-[#E1E5EA] dark:border-[#2E3033] bg-white dark:bg-[#1E1F20] shadow-2xl">
            <div className="flex items-center justify-between gap-2 border-b border-[#E8EDF4] dark:border-[#2E3033] px-4 py-3">
              <div
                className="grid flex-1 grid-cols-2 gap-1 rounded-full bg-[#F0F4F9] dark:bg-[#282A2C] p-1"
                role="tablist"
                aria-label="Context drawer view"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={drawerTab === 'memory'}
                  onClick={() => setDrawerTab('memory')}
                  className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
                    drawerTab === 'memory'
                      ? 'bg-white dark:bg-[#131314] text-[#1F1F1F] dark:text-[#E3E3E3] shadow-xs'
                      : 'text-[#5F6368] dark:text-[#9AA0A6] hover:text-[#1F1F1F] dark:hover:text-white'
                  }`}
                >
                  Memory &amp; Queue
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={drawerTab === 'workspace'}
                  onClick={() => setDrawerTab('workspace')}
                  className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
                    drawerTab === 'workspace'
                      ? 'bg-white dark:bg-[#131314] text-[#1F1F1F] dark:text-[#E3E3E3] shadow-xs'
                      : 'text-[#5F6368] dark:text-[#9AA0A6] hover:text-[#1F1F1F] dark:hover:text-white'
                  }`}
                >
                  Status &amp; Rules
                </button>
              </div>
              <button
                type="button"
                onClick={onCloseContextDrawer}
                aria-label="Close context drawer"
                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[#5F6368] hover:bg-[#F0F4F9] dark:hover:bg-[#282A2C] hover:text-[#1F1F1F] dark:hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto">
              {drawerTab === 'memory' ? (
                <>
                  {/* Chat Memory */}
                  <div className="border-b border-[#E8EDF4] dark:border-[#2E3033] p-5 space-y-3.5">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <Brain className="h-4 w-4 text-[#1A73E8] dark:text-[#8AB4F8]" aria-hidden="true" />
                        <h2 className="text-sm font-semibold text-[#1F1F1F] dark:text-[#E3E3E3]">
                          Chat Memory
                        </h2>
                      </div>
                      <div className="flex items-center gap-2 text-xs">
                        {safeMemoryFacts.length > 0 && (
                          <button
                            type="button"
                            onClick={() => void onClearMemoryFacts()}
                            className="text-[11px] font-medium text-[#5F6368] hover:text-[#D93025] whitespace-nowrap shrink-0"
                          >
                            Clear
                          </button>
                        )}
                        <span
                          className={`font-mono text-[11px] font-medium ${
                            memoryEnabled
                              ? 'text-[#188038] dark:text-[#81C995]'
                              : 'text-[#5F6368] dark:text-[#9AA0A6]'
                          }`}
                        >
                          {memoryEnabled ? 'ON' : 'OFF'}
                        </span>
                      </div>
                    </div>

                    <form onSubmit={handleAddMemorySubmit} className="flex items-center gap-2">
                      <input
                        type="text"
                        value={newMemoryText}
                        onChange={(e) => setNewMemoryText(e.target.value)}
                        placeholder="Add preference or project note..."
                        aria-label="Add chat memory fact"
                        className="min-w-0 flex-1 rounded-full border border-[#DDE3EA] dark:border-[#3C4043] bg-[#F8FAFD] dark:bg-[#131314] px-3.5 py-2 text-xs text-[#1F1F1F] dark:text-[#E3E3E3] placeholder:text-[#5F6368] focus:border-[#1A73E8] focus:outline-none"
                      />
                      <button
                        type="submit"
                        disabled={!newMemoryText.trim() || memoryBusy}
                        aria-label="Save memory note"
                        className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#1A73E8] text-white hover:bg-[#1557B0] disabled:opacity-40"
                      >
                        <Plus className="h-4 w-4" />
                      </button>
                    </form>

                    {safeMemoryFacts.length === 0 ? (
                      <p className="text-xs leading-relaxed text-[#5F6368] dark:text-[#9AA0A6]">
                        No saved facts yet. Add a note above or tell IND AGENT &ldquo;Remember
                        that...&rdquo; to persist preferences across chats.
                      </p>
                    ) : (
                      <ul className="space-y-2 max-h-60 overflow-y-auto">
                        {safeMemoryFacts.map((fact) => (
                          <li
                            key={fact.id}
                            className="flex items-start justify-between gap-2 rounded-xl bg-[#F0F4F9] dark:bg-[#282A2C] px-3 py-2 text-xs text-[#1F1F1F] dark:text-[#E3E3E3]"
                          >
                            <span className="leading-snug break-words">{fact.content}</span>
                            <button
                              type="button"
                              aria-label={`Delete memory: ${fact.content}`}
                              onClick={() => void onDeleteMemoryFact(fact.id)}
                              className="mt-0.5 shrink-0 text-[#5F6368] hover:text-[#D93025]"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>

                  {/* Approval Queue */}
                  <div className="p-5 space-y-3">
                    <div className="flex items-center justify-between">
                      <h2 className="text-sm font-semibold text-[#1F1F1F] dark:text-[#E3E3E3]">
                        Approval Queue
                      </h2>
                      <button
                        type="button"
                        onClick={() => {
                          onCloseContextDrawer();
                          onNavigateApprovals();
                        }}
                        className="text-xs font-medium text-[#1A73E8] dark:text-[#8AB4F8] hover:underline whitespace-nowrap shrink-0"
                      >
                        View all
                      </button>
                    </div>
                    {pendingActions.length === 0 ? (
                      <p className="text-xs leading-relaxed text-[#5F6368] dark:text-[#9AA0A6]">
                        No pending changes. Gmail drafts, emails, and Google Drive saves appear
                        here for preview before execution.
                      </p>
                    ) : (
                      <div className="space-y-2.5">
                        {pendingActions.slice(0, 4).map((act) => (
                          <div
                            key={act.id}
                            className="rounded-xl bg-[#F0F4F9] dark:bg-[#282A2C] p-3 space-y-1"
                          >
                            <div className="text-xs font-semibold text-[#1F1F1F] dark:text-[#E3E3E3] truncate">
                              {act.title}
                            </div>
                            <div className="text-xs text-[#5F6368] dark:text-[#9AA0A6] truncate">
                              {act.summary}
                            </div>
                            <button
                              type="button"
                              onClick={() => {
                                onCloseContextDrawer();
                                onNavigateApprovals();
                              }}
                              className="pt-1 text-xs font-medium text-[#1A73E8] dark:text-[#8AB4F8] hover:underline"
                            >
                              Review preview
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </>
              ) : (
                <>
                  {/* Integrations */}
                  <div className="border-b border-[#E8EDF4] dark:border-[#2E3033] p-5 space-y-3">
                    <div className="flex items-center justify-between">
                      <h2 className="text-sm font-semibold text-[#1F1F1F] dark:text-[#E3E3E3]">
                        Connected Tools
                      </h2>
                      <button
                        type="button"
                        onClick={() => {
                          onCloseContextDrawer();
                          onNavigateTools();
                        }}
                        className="text-xs font-medium text-[#1A73E8] dark:text-[#8AB4F8] hover:underline"
                      >
                        Manage
                      </button>
                    </div>
                    <dl className="space-y-2 text-xs">
                      <div className="flex items-center justify-between gap-2 py-1">
                        <dt className="text-[#5F6368] dark:text-[#9AA0A6]">Google Drive</dt>
                        <dd
                          className={`truncate ${
                            toolStatus?.drive?.connected
                              ? 'font-medium text-[#188038] dark:text-[#81C995]'
                              : 'text-[#5F6368] dark:text-[#9AA0A6]'
                          }`}
                        >
                          {toolStatus?.drive?.connected
                            ? toolStatus.drive.accountLabel || 'Connected'
                            : 'Not connected'}
                        </dd>
                      </div>
                      <div className="flex items-center justify-between gap-2 py-1 border-t border-[#F0F4F9] dark:border-[#2E3033]">
                        <dt className="text-[#5F6368] dark:text-[#9AA0A6]">Gmail</dt>
                        <dd
                          className={`truncate ${
                            toolStatus?.gmail?.connected
                              ? 'font-medium text-[#188038] dark:text-[#81C995]'
                              : 'text-[#5F6368] dark:text-[#9AA0A6]'
                          }`}
                        >
                          {toolStatus?.gmail?.connected
                            ? toolStatus.gmail.accountLabel || 'Connected'
                            : 'Not connected'}
                        </dd>
                      </div>
                    </dl>
                  </div>

                  {/* Plan & Daily Usage */}
                  <div className="border-b border-[#E8EDF4] dark:border-[#2E3033] p-5 space-y-3">
                    <div className="flex items-center justify-between">
                      <h2 className="text-sm font-semibold text-[#1F1F1F] dark:text-[#E3E3E3]">
                        Plan &amp; Usage
                      </h2>
                      <button
                        type="button"
                        onClick={() => {
                          onCloseContextDrawer();
                          onNavigatePlans();
                        }}
                        className="text-xs font-medium text-[#1A73E8] dark:text-[#8AB4F8] hover:underline"
                      >
                        7-Day Chart
                      </button>
                    </div>
                    <div className="space-y-2 text-xs">
                      <div className="flex items-center justify-between">
                        <span className="text-[#5F6368] dark:text-[#9AA0A6]">Active Tier</span>
                        <span className="font-semibold text-[#1F1F1F] dark:text-[#E3E3E3]">
                          {isPlus ? 'IND AGENT Plus' : 'Free'}
                        </span>
                      </div>
                      {!isPlus && (
                        <div className="space-y-1.5">
                          <div className="flex items-center justify-between">
                            <span className="text-[#5F6368] dark:text-[#9AA0A6]">
                              Daily Messages
                            </span>
                            <span className="font-mono tabular-nums font-medium text-[#1F1F1F] dark:text-[#E3E3E3]">
                              {used} / {limit}
                            </span>
                          </div>
                          <div className="h-1.5 w-full overflow-hidden rounded-full bg-[#E8EDF4] dark:bg-[#282A2C]">
                            <div
                              className={`h-full transition-all ${
                                used >= limit ? 'bg-[#D93025]' : 'bg-[#1A73E8]'
                              }`}
                              style={{ width: `${Math.min(100, Math.round((used / limit) * 100))}%` }}
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Safety Rules */}
                  <div className="p-5 space-y-3">
                    <div className="flex items-center gap-2">
                      <ShieldCheck className="h-4 w-4 text-[#1F1F1F] dark:text-[#E3E3E3]" aria-hidden="true" />
                      <h2 className="text-sm font-semibold text-[#1F1F1F] dark:text-[#E3E3E3]">
                        Safety Rules
                      </h2>
                    </div>
                    <ol className="space-y-2 text-xs leading-relaxed text-[#5F6368] dark:text-[#9AA0A6]">
                      <li>1. Preview every Drive save, overwrite, delete, or email first.</li>
                      <li>2. Google Drive uses minimal drive.file scope (IND AGENT folder).</li>
                      <li>3. Prefer Gmail drafts; confirm explicitly before sending mail.</li>
                      <li>4. Deleting Gmail emails is permanently blocked.</li>
                      <li>5. OAuth tokens are encrypted per-user with AES-256-GCM.</li>
                    </ol>
                  </div>
                </>
              )}
            </div>
          </aside>
        </div>
      )}

      <PromptOptimizerPanel
        open={optimizerOpen}
        rawPrompt={optimizerRawSnapshot || draftInput}
        focus={optimizerFocus}
        loading={optimizerLoading}
        error={optimizerError}
        result={optimizerResult}
        sending={sending}
        onChangeFocus={handleChangeOptimizerFocus}
        onRetry={() => void runPromptOptimizer(optimizerRawSnapshot || draftInput, optimizerFocus)}
        onClose={() => setOptimizerOpen(false)}
        onApplyToComposer={handleApplyOptimizedPrompt}
        onSendOptimized={(prompt) => void handleSendOptimizedPrompt(prompt)}
      />
    </div>
  );
}
