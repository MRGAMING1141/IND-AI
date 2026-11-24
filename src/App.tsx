import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import {
  BookOpen,
  Briefcase,
  Check,
  CheckSquare,
  ChevronDown,
  Clock,
  Cpu,
  Filter,
  Hexagon,
  LayoutGrid,
  Lock,
  LogIn,
  Moon,
  Plus,
  Search,
  Settings,
  Sun,
  Trash2,
  X,
} from 'lucide-react';
import { CommandView } from './components/CommandView';
import { ApprovalsView } from './components/ApprovalsView';
import { ToolsView } from './components/ToolsView';
import { BusinessView } from './components/BusinessView';
import { PlansView } from './components/PlansView';
import { HtmlPreviewModal } from './components/HtmlPreviewModal';
import { ArtifactWorkbench } from './components/ArtifactWorkbench';
import { SkillsModal } from './components/SkillsModal';
import { SettingsModal } from './components/SettingsModal';
import { AccountSheetModal, getInitials } from './components/AccountSheetModal';
import {
  addMemoryFact,
  adminSetUserPlanOnServer,
  approveAction,
  clearMemoryFacts,
  createFirebaseServerSession,
  deleteMemoryFact,
  disconnectDrive,
  disconnectGmail,
  fetchAccount,
  fetchActions,
  fetchBillingDefaults,
  fetchMemoryFacts,
  fetchToolStatus,
  hydrateServerUsage,
  logoutFirebaseServerSession,
  queueManualAction,
  rejectAction,
  saveDriveServerSession,
  saveGmailServerSession,
  sendAgentChatStream,
} from './services/api';
import {
  auth,
  signInWithGoogleAccount,
  signOutAccount,
  testFirestoreConnection,
} from './services/firebase';
import {
  deleteCloudMemoryFact,
  deleteCloudSession,
  deleteCloudSkill,
  ensureCloudUserProfile,
  incrementCloudUsageWindow,
  reviewPaymentRequestAndActivatePlan,
  saveBillingSettings,
  saveCloudCustomInstructions,
  saveCloudMemoryFact,
  saveCloudSession,
  saveCloudSkill,
  saveCloudUsageWindow,
  setOwnerTestingPlan,
  submitPaymentRequest,
  subscribeAllPaymentRequests,
  subscribeBillingSettings,
  subscribeCloudMemories,
  subscribeCloudProfile,
  subscribeCloudSessions,
  subscribeCloudSkills,
  subscribeUserPaymentRequests,
} from './services/cloudSync';
import {
  signInWithGoogleDrive,
  signInWithGoogleGmail,
} from './services/googleAuth';
import { extractErrorDisplay } from './utils/apiResponse';
import { stripAttachmentPayloadsForHistory } from './utils/attachments';
import { detectWebsiteArtifact, extractProjectFiles } from './utils/messageParser';
import { isAdminEmail } from './utils/paymentEngine';
import {
  GUEST_WINDOW_MESSAGE_LIMIT,
  SIGNED_IN_WINDOW_MESSAGE_LIMIT,
  USAGE_WINDOW_HOURS,
  evaluateUsageWindow,
  getWindowMessageLimit,
} from './utils/planEngine';
import {
  DEFAULT_SKILLS,
  clampCustomInstructions,
  resolveSkillInvocation,
} from './utils/skillsEngine';
import type {
  AgentMode,
  AgentTaskStep,
  ArtifactSession,
  ArtifactVersion,
  BillingSettings,
  BusinessTask,
  ChatAttachment,
  ChatMessage,
  ChatSession,
  CustomInstructionsConfig,
  GeneratedProjectFile,
  MemoryFact,
  ModelChoice,
  PaymentRequestRecord,
  PendingAction,
  SkillDefinition,
  ToolStatusSummary,
  UserAccountSummary,
  WorkspaceView,
} from './types/agent';

const TASKS_STORAGE_KEY = 'ind_agent_workspace_tasks_v2';
const PREFS_STORAGE_KEY = 'ind_agent_ui_prefs_v1';
const THEME_STORAGE_KEY = 'ind_agent_theme_v1';
const LEGACY_LOCAL_MSG_KEYS = [
  'ind_agent_chat_sessions_v1',
  'ind_agent_custom_skills_v1',
  'ind_agent_custom_instructions_v1',
];
const MAX_SAVED_SESSIONS = 20;

const DEFAULT_TOOL_STATUS: ToolStatusSummary = {
  gmail: { connected: false },
  drive: { connected: false, folderName: 'IND AGENT' },
};

const DEFAULT_ACCOUNT: UserAccountSummary = {
  userId: 'local',
  authType: 'guest',
  displayName: 'Guest Workspace',
  plan: 'free',
  usage: {
    used: 0,
    limit: GUEST_WINDOW_MESSAGE_LIMIT,
    remaining: GUEST_WINDOW_MESSAGE_LIMIT,
    windowDurationHours: USAGE_WINDOW_HOURS,
    windowStartedAtMs: 0,
    resetsAt: null,
  },
};

function loadInitialTasks(): BusinessTask[] {
  try {
    const raw = window.localStorage.getItem(TASKS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed as BusinessTask[];
  } catch {
    // Ignore storage read errors
  }
  return [];
}

function loadInitialPrefs(): {
  fastMode: boolean;
  debugLoop: boolean;
  showTasks: boolean;
  memoryEnabled: boolean;
} {
  try {
    const raw = window.localStorage.getItem(PREFS_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      return {
        fastMode: parsed.fastMode !== false,
        debugLoop: parsed.debugLoop !== false,
        showTasks: parsed.showTasks !== false,
        memoryEnabled: parsed.memoryEnabled !== false,
      };
    }
  } catch {
    // Ignore storage read errors
  }
  return { fastMode: true, debugLoop: true, showTasks: true, memoryEnabled: true };
}

function loadInitialTheme(): 'light' | 'dark' {
  try {
    const saved = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (saved === 'dark' || saved === 'light') return saved;
  } catch {
    // Ignore storage read errors
  }
  return 'light';
}

function makeSessionTitle(text: string, attachments?: ChatAttachment[]): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean) return clean.length > 44 ? `${clean.slice(0, 44)}...` : clean;
  if (attachments && attachments.length > 0) {
    return `Attachment: ${attachments[0].name}`.slice(0, 44);
  }
  return 'New chat';
}

const VIEW_LABELS: Record<WorkspaceView, string> = {
  command: 'Chat',
  approvals: 'Approvals',
  tools: 'Tools',
  business: 'Business Ops',
  plans: 'Plans & Usage',
};

interface SignedInProfile {
  uid: string;
  displayName: string;
  email: string;
  photoURL?: string;
}

/** Minimal 2-bar '=' menu icon matching Reference Screenshot 3 */
function TwoBarMenuIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-5 w-5"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <line x1="4" y1="9" x2="20" y2="9" />
      <line x1="4" y1="15" x2="20" y2="15" />
    </svg>
  );
}

/** Dashed-circle compose icon matching top-right of Reference Screenshot 3 */
function DashedComposeIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-[22px] w-[22px]"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="8.5" strokeDasharray="2.2 3" />
      <path d="M9.5 14.5l1-3.4 4.8-4.8a1.2 1.2 0 011.7 1.7l-4.8 4.8-2.7 1.7z" fill="currentColor" fillOpacity="0.1" />
    </svg>
  );
}

/** Open-circle compose pen icon matching 'New chat' pill in Reference Screenshot 1 */
function ComposeCircleIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-5 w-5 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 4.5A7.5 7.5 0 1 0 19.5 12" />
      <path d="M11 13l7.5-7.5a1.4 1.4 0 0 1 2 2L13 15l-3 1 1-3z" />
    </svg>
  );
}

export default function App() {
  const [activeView, setActiveView] = useState<WorkspaceView>('command');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [contextDrawerOpen, setContextDrawerOpen] = useState(false);
  const [skillsModalOpen, setSkillsModalOpen] = useState(false);
  const [settingsModalOpen, setSettingsModalOpen] = useState(false);
  const [accountSheetOpen, setAccountSheetOpen] = useState(false);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [showHyperUpgradePrompt, setShowHyperUpgradePrompt] = useState(false);
  const [theme, setTheme] = useState<'light' | 'dark'>(() => loadInitialTheme());
  const [confirmClearSidebar, setConfirmClearSidebar] = useState(false);
  const [sidebarSearchOpen, setSidebarSearchOpen] = useState(false);
  const [sidebarSearchQuery, setSidebarSearchQuery] = useState('');
  const [sidebarModeFilter, setSidebarModeFilter] = useState<'all' | 'coding' | 'business'>('all');
  const modelMenuRef = useRef<HTMLDivElement | null>(null);

  // Firebase Auth + Cloud Sync state
  const [authUser, setAuthUser] = useState<SignedInProfile | null>(null);
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  // Account & Plan state
  const [account, setAccount] = useState<UserAccountSummary>(DEFAULT_ACCOUNT);
  const [modelChoice, setModelChoice] = useState<ModelChoice>('standard');

  // FamPay / UPI Billing & Payment Verification state
  const [cloudBillingSettings, setCloudBillingSettings] = useState<BillingSettings | null>(null);
  const [defaultBillingSettings, setDefaultBillingSettings] = useState<BillingSettings | null>(null);
  const [userPaymentRequests, setUserPaymentRequests] = useState<PaymentRequestRecord[]>([]);
  const [allPaymentRequests, setAllPaymentRequests] = useState<PaymentRequestRecord[]>([]);
  const isOwner = useMemo(() => isAdminEmail(authUser?.email), [authUser?.email]);
  const effectiveBillingSettings = useMemo<BillingSettings | null>(() => {
    if (cloudBillingSettings?.upiId) return cloudBillingSettings;
    if (defaultBillingSettings?.upiId) return defaultBillingSettings;
    return cloudBillingSettings ?? defaultBillingSettings;
  }, [cloudBillingSettings, defaultBillingSettings]);

  // Interactive toggles (Fast Mode, Debug Loop, AI Tasks, Chat Memory)
  const [prefs, setPrefs] = useState(() => loadInitialPrefs());
  const { fastMode, debugLoop, showTasks, memoryEnabled } = prefs;

  // Custom Instructions (1,500 chars limit) & Skills — stored in Firestore Cloud Storage when signed in
  const [customInstructions, setCustomInstructions] = useState<CustomInstructionsConfig>({
    text: '',
    enabled: true,
  });
  const [customSkills, setCustomSkills] = useState<SkillDefinition[]>([]);
  const allSkills = useMemo(
    () => [...DEFAULT_SKILLS, ...customSkills],
    [customSkills]
  );

  // Cloud-Backed Chat Sessions (Firestore when signed in; temporary in-memory for guest, never localStorage)
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string>(() => `chat_${Date.now()}`);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [memoryFacts, setMemoryFacts] = useState<MemoryFact[]>([]);

  // Chat state + live streaming + Split-Pane Artifacts Workbench
  const [mode, setMode] = useState<AgentMode>('auto');
  const [draftInput, setDraftInput] = useState('');
  const [sending, setSending] = useState(false);
  const [liveTasks, setLiveTasks] = useState<AgentTaskStep[]>([]);
  const [streamingReply, setStreamingReply] = useState('');
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [activeArtifact, setActiveArtifact] = useState<ArtifactSession | null>(null);

  // Approvals & Tools state
  const [actions, setActions] = useState<PendingAction[]>([]);
  const [gmailBusy, setGmailBusy] = useState(false);
  const [gmailError, setGmailError] = useState<string | null>(null);
  const [driveBusy, setDriveBusy] = useState(false);
  const [driveError, setDriveError] = useState<string | null>(null);
  const [toolStatus, setToolStatus] = useState<ToolStatusSummary>(DEFAULT_TOOL_STATUS);

  // Business Ops state
  const [tasks, setTasks] = useState<BusinessTask[]>(() => loadInitialTasks());

  // Refs for latest values inside async callbacks
  const authUserRef = useRef(authUser);
  authUserRef.current = authUser;
  const customInstructionsRef = useRef(customInstructions);
  customInstructionsRef.current = customInstructions;
  const activeArtifactRef = useRef(activeArtifact);
  activeArtifactRef.current = activeArtifact;
  const sessionsRef = useRef(sessions);
  sessionsRef.current = sessions;
  const activeSessionIdRef = useRef(activeSessionId);
  activeSessionIdRef.current = activeSessionId;
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const modeRef = useRef(mode);
  modeRef.current = mode;

  // Startup Firestore connectivity check + billing config subscription + purge legacy localStorage
  useEffect(() => {
    void testFirestoreConnection();
    const unsubBilling = subscribeBillingSettings((settings) => {
      setCloudBillingSettings(settings);
    });
    void fetchBillingDefaults()
      .then((defaults) => {
        setDefaultBillingSettings(defaults);
      })
      .catch(() => {});
    try {
      for (const key of LEGACY_LOCAL_MSG_KEYS) {
        window.localStorage.removeItem(key);
      }
    } catch {
      // Ignore storage access errors
    }
    return () => {
      unsubBilling();
    };
  }, []);

  // Sync theme with <html class="dark">
  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // Ignore storage write errors
    }
  }, [theme]);

  // Close model selector dropdown on outside click
  useEffect(() => {
    if (!modelMenuOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (modelMenuRef.current && !modelMenuRef.current.contains(e.target as Node)) {
        setModelMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [modelMenuOpen]);

  useEffect(() => {
    try {
      window.localStorage.setItem(PREFS_STORAGE_KEY, JSON.stringify(prefs));
    } catch {
      // Ignore storage write errors
    }
  }, [prefs]);

  useEffect(() => {
    try {
      window.localStorage.setItem(TASKS_STORAGE_KEY, JSON.stringify(tasks));
    } catch {
      // Ignore storage write errors
    }
  }, [tasks]);

  const refreshAccount = useCallback(async () => {
    try {
      const next = await fetchAccount();
      setAccount(next);
      if (next.plan !== 'plus') {
        setModelChoice('standard');
      }
    } catch {
      // Keep previous account snapshot if temporarily offline
    }
  }, []);

  const refreshStatus = useCallback(async () => {
    try {
      const status = await fetchToolStatus();
      setToolStatus(status);
    } catch {
      // Keep previous status if temporarily offline
    }
  }, []);

  const refreshActions = useCallback(async () => {
    try {
      const list = await fetchActions();
      setActions(Array.isArray(list) ? list : []);
    } catch {
      // Keep current actions list if temporarily offline
    }
  }, []);

  const refreshMemory = useCallback(async () => {
    try {
      const facts = await fetchMemoryFacts();
      setMemoryFacts(Array.isArray(facts) ? facts : []);
    } catch {
      // Keep current memory list if temporarily offline
    }
  }, []);

  useEffect(() => {
    void refreshAccount();
    void refreshStatus();
    void refreshActions();
    void refreshMemory();
  }, [refreshAccount, refreshStatus, refreshActions, refreshMemory]);

  // Firebase Auth listener + real-time Firestore Cloud Sync subscriptions
  useEffect(() => {
    let unsubProfile: (() => void) | null = null;
    let unsubSessions: (() => void) | null = null;
    let unsubMemories: (() => void) | null = null;
    let unsubSkills: (() => void) | null = null;
    let unsubUserPayments: (() => void) | null = null;
    let unsubAllPayments: (() => void) | null = null;

    const cleanupSubs = () => {
      unsubProfile?.();
      unsubSessions?.();
      unsubMemories?.();
      unsubSkills?.();
      unsubUserPayments?.();
      unsubAllPayments?.();
      unsubProfile = null;
      unsubSessions = null;
      unsubMemories = null;
      unsubSkills = null;
      unsubUserPayments = null;
      unsubAllPayments = null;
    };

    const unsubAuth = onAuthStateChanged(auth, async (fbUser) => {
      cleanupSubs();
      if (!fbUser || !fbUser.emailVerified) {
        setAuthUser(null);
        setUserPaymentRequests([]);
        setAllPaymentRequests([]);
        return;
      }

      const profile: SignedInProfile = {
        uid: fbUser.uid,
        displayName: fbUser.displayName || fbUser.email?.split('@')[0] || 'Google User',
        email: fbUser.email || '',
        photoURL: fbUser.photoURL || undefined,
      };
      setAuthUser(profile);

      let cloudUsage: { windowStartedAtMs: number; windowMessagesUsed: number } | undefined;
      let lastKnownPlan: 'free' | 'plus' = 'free';

      try {
        // Load/ensure parent /users/{uid} FIRST so persisted Firestore usage & plan hydrate server immediately after restarts
        const ensured = await ensureCloudUserProfile(fbUser, customInstructionsRef.current);
        lastKnownPlan = ensured.plan;
        cloudUsage = {
          windowStartedAtMs: ensured.usageWindowStart,
          windowMessagesUsed: ensured.usageWindowCount,
        };
        if (ensured.customInstructions) {
          setCustomInstructions({
            text: ensured.customInstructions,
            enabled: ensured.customInstructionsEnabled,
          });
        }

        // Apply Firestore usage & plan immediately in UI even while server session bootstraps
        const evalUsage = evaluateUsageWindow(ensured.usageWindowStart, ensured.usageWindowCount);
        const cloudLimit = getWindowMessageLimit(ensured.plan, 'google');
        setAccount((prev) => ({
          ...prev,
          authType: 'google',
          displayName: ensured.displayName,
          email: ensured.email,
          plan: ensured.plan,
          planExpiresAt: ensured.planExpiresAt || null,
          usage: {
            used: evalUsage.used,
            limit: cloudLimit,
            remaining: cloudLimit === null ? null : Math.max(0, cloudLimit - evalUsage.used),
            windowDurationHours: USAGE_WINDOW_HOURS,
            windowStartedAtMs: evalUsage.windowStartedAtMs,
            resetsAt: evalUsage.resetsAt,
          },
        }));

        unsubProfile = subscribeCloudProfile(fbUser.uid, (cloudProfile) => {
          setCustomInstructions({
            text: cloudProfile.customInstructions,
            enabled: cloudProfile.customInstructionsEnabled,
          });
          const liveEval = evaluateUsageWindow(
            cloudProfile.usageWindowStart,
            cloudProfile.usageWindowCount
          );
          const liveLimit = getWindowMessageLimit(cloudProfile.plan, 'google');
          setAccount((prev) => ({
            ...prev,
            plan: cloudProfile.plan,
            planExpiresAt: cloudProfile.planExpiresAt || null,
            usage: {
              used: liveEval.used,
              limit: liveLimit,
              remaining: liveLimit === null ? null : Math.max(0, liveLimit - liveEval.used),
              windowDurationHours: USAGE_WINDOW_HOURS,
              windowStartedAtMs: liveEval.windowStartedAtMs,
              resetsAt: liveEval.resetsAt,
            },
          }));
          if (cloudProfile.plan !== lastKnownPlan) {
            lastKnownPlan = cloudProfile.plan;
            void fbUser
              .getIdToken()
              .then((token) => createFirebaseServerSession(token))
              .then((synced) => setAccount(synced))
              .catch(() => {});
          }
          if (liveEval.windowStartedAtMs > 0 && liveEval.used > 0) {
            void hydrateServerUsage(liveEval.windowStartedAtMs, liveEval.used).catch(() => {});
          }
        });

        unsubUserPayments = subscribeUserPaymentRequests(fbUser.uid, (reqs) => {
          setUserPaymentRequests(reqs);
        });

        if (isAdminEmail(fbUser.email)) {
          unsubAllPayments = subscribeAllPaymentRequests((reqs) => {
            setAllPaymentRequests(reqs);
          });
        } else {
          setAllPaymentRequests([]);
        }

        unsubSessions = subscribeCloudSessions(fbUser.uid, (cloudSessions) => {
          setSessions(cloudSessions);
        });

        // If user already started a conversation in-memory before signing in, record it to Cloud Storage
        if (messagesRef.current.length > 0) {
          const firstUserMsg = messagesRef.current.find((m) => m.role === 'user');
          const title = firstUserMsg
            ? makeSessionTitle(firstUserMsg.content)
            : 'IND AGENT Chat';
          const pendingSession: ChatSession = {
            id: activeSessionIdRef.current,
            title,
            updatedAt: new Date().toISOString(),
            mode: modeRef.current,
            messages: messagesRef.current,
          };
          void saveCloudSession(fbUser.uid, pendingSession).catch(() => {});
        }

        unsubMemories = subscribeCloudMemories(fbUser.uid, (cloudFacts) => {
          setMemoryFacts(cloudFacts);
        });

        unsubSkills = subscribeCloudSkills(fbUser.uid, (cloudSkills) => {
          setCustomSkills(cloudSkills);
        });
      } catch {
        // Firestore errors are handled and logged via handleFirestoreError
      }

      try {
        const idToken = await fbUser.getIdToken();
        const serverAccount = await createFirebaseServerSession(idToken, cloudUsage);
        setAccount(serverAccount);
        // If server already had a higher in-memory usage count for the same active window, mirror it back to Firestore
        if (
          serverAccount.usage.windowStartedAtMs > 0 &&
          serverAccount.usage.used > (cloudUsage?.windowMessagesUsed ?? 0)
        ) {
          void saveCloudUsageWindow(
            fbUser.uid,
            serverAccount.usage.windowStartedAtMs,
            serverAccount.usage.used
          ).catch(() => {});
        }
        await Promise.all([refreshStatus(), refreshActions()]);
      } catch {
        // Server session sync is best-effort; Firestore sync still proceeds
      }
    });

    return () => {
      cleanupSubs();
      unsubAuth();
    };
  }, [refreshStatus, refreshActions]);

  // Record chat sessions in-memory (and directly to Firestore Cloud Storage when signed in; never localStorage)
  useEffect(() => {
    if (messages.length === 0) return;

    const sanitizedMessages: ChatMessage[] = messages.map((m) => ({
      ...m,
      attachments: m.attachments
        ? m.attachments.map(({ id, kind, name, mimeType, size }) => ({
            id,
            kind,
            name,
            mimeType,
            size,
          }))
        : undefined,
    }));

    const firstUserMsg = sanitizedMessages.find((m) => m.role === 'user');
    const title = firstUserMsg
      ? makeSessionTitle(firstUserMsg.content)
      : 'IND AGENT Chat';

    const existing = sessionsRef.current.find((s) => s.id === activeSessionId);
    const updatedSession: ChatSession = {
      id: activeSessionId,
      title: existing?.title || title,
      updatedAt: new Date().toISOString(),
      mode,
      messages: sanitizedMessages,
    };

    setSessions((prev) => {
      const others = prev.filter((s) => s.id !== activeSessionId);
      return [updatedSession, ...others].slice(0, MAX_SAVED_SESSIONS);
    });

    if (authUser && !sending) {
      void saveCloudSession(authUser.uid, updatedSession).catch(() => {
        // Logged via handleFirestoreError
      });
    }
  }, [messages, activeSessionId, mode, authUser, sending]);

  const handleSignInGoogle = async () => {
    setAuthBusy(true);
    setAuthError(null);
    try {
      const { user, idToken } = await signInWithGoogleAccount();
      let cloudUsage: { windowStartedAtMs: number; windowMessagesUsed: number } | undefined;
      try {
        const ensured = await ensureCloudUserProfile(user, customInstructionsRef.current);
        cloudUsage = {
          windowStartedAtMs: ensured.usageWindowStart,
          windowMessagesUsed: ensured.usageWindowCount,
        };
      } catch {
        // Proceed with server session creation even if initial Firestore read fails
      }
      const serverAccount = await createFirebaseServerSession(idToken, cloudUsage);
      setAccount(serverAccount);
      await Promise.all([refreshStatus(), refreshActions()]);
    } catch (err) {
      setAuthError(extractErrorDisplay(err).message);
    } finally {
      setAuthBusy(false);
    }
  };

  const handleSignOutGoogle = async () => {
    setAuthBusy(true);
    setAuthError(null);
    try {
      await signOutAccount();
      const guestAccount = await logoutFirebaseServerSession();
      setAuthUser(null);
      setAccount(guestAccount);
      setSessions([]);
      setActiveSessionId(`chat_${Date.now()}`);
      setMessages([]);
      setCustomSkills([]);
      setCustomInstructions({ text: '', enabled: true });
      setActiveArtifact(null);
      setShowHyperUpgradePrompt(false);
      await Promise.all([refreshStatus(), refreshActions(), refreshMemory()]);
    } catch (err) {
      setAuthError(extractErrorDisplay(err).message);
    } finally {
      setAuthBusy(false);
    }
  };

  const handleSaveCustomInstructions = async (config: CustomInstructionsConfig) => {
    const normalized: CustomInstructionsConfig = {
      text: clampCustomInstructions(config.text),
      enabled: Boolean(config.enabled),
    };
    setCustomInstructions(normalized);
    if (authUser) {
      await saveCloudCustomInstructions(authUser.uid, normalized);
    }
  };

  const handleSaveCustomSkill = async (
    skillInput: Omit<SkillDefinition, 'id' | 'builtIn'>,
    editingId?: string
  ) => {
    const skillObj: SkillDefinition = {
      id: editingId ?? `skill_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      ...skillInput,
      builtIn: false,
    };
    setCustomSkills((prev) => {
      if (editingId) {
        return prev.map((s) => (s.id === editingId ? skillObj : s));
      }
      return [skillObj, ...prev];
    });
    if (authUser) {
      await saveCloudSkill(authUser.uid, skillObj);
    }
  };

  const handleDeleteCustomSkill = async (skillId: string) => {
    setCustomSkills((prev) => prev.filter((s) => s.id !== skillId));
    if (authUser) {
      await deleteCloudSkill(authUser.uid, skillId);
    }
  };

  const handleUseSkill = (skill: SkillDefinition) => {
    setActiveView('command');
    if (skill.mode !== 'auto') {
      setMode(skill.mode);
    }
    setDraftInput(`${skill.command} `);
    setMobileNavOpen(false);
  };

  const handleAddMemoryFact = async (content: string, category: MemoryFact['category']) => {
    const next = await addMemoryFact(content, category);
    setMemoryFacts(next);
    if (authUser && next[0]) {
      void saveCloudMemoryFact(authUser.uid, next[0]).catch(() => {});
    }
  };

  const handleDeleteMemoryFact = async (id: string) => {
    const next = await deleteMemoryFact(id);
    setMemoryFacts(next);
    if (authUser) {
      void deleteCloudMemoryFact(authUser.uid, id).catch(() => {});
    }
  };

  const handleClearMemoryFacts = async () => {
    const prevFacts = [...memoryFacts];
    const next = await clearMemoryFacts();
    setMemoryFacts(next);
    if (authUser) {
      await Promise.allSettled(
        prevFacts.map((f) => deleteCloudMemoryFact(authUser.uid, f.id))
      );
    }
  };

  const navigateToView = useCallback((nextView: WorkspaceView) => {
    setActiveView(nextView);
    setShowHyperUpgradePrompt(false);
    setModelMenuOpen(false);
    setContextDrawerOpen(false);
    setMobileNavOpen(false);
    setAuthError(null);
    setConfirmClearSidebar(false);
    if (nextView !== 'command') {
      setActiveArtifact(null);
    }
  }, []);

  const handleSelectSession = (session: ChatSession) => {
    setActiveSessionId(session.id);
    setMessages(Array.isArray(session.messages) ? session.messages : []);
    setMode(session.mode ?? 'auto');
    setLiveTasks([]);
    setStreamingReply('');
    setActiveArtifact(null);
    navigateToView('command');
  };

  const handleDeleteSession = async (sessionId: string) => {
    setSessions((prev) => prev.filter((s) => s.id !== sessionId));
    if (sessionId === activeSessionId) {
      setActiveSessionId(`chat_${Date.now()}`);
      setMessages([]);
      setDraftInput('');
      setLiveTasks([]);
      setStreamingReply('');
      setActiveArtifact(null);
      setShowHyperUpgradePrompt(false);
    }
    if (authUser) {
      void deleteCloudSession(authUser.uid, sessionId).catch(() => {});
    }
  };

  const handleClearAllChats = async () => {
    const oldIds = sessions.map((s) => s.id);
    setSessions([]);
    setActiveSessionId(`chat_${Date.now()}`);
    setMessages([]);
    setDraftInput('');
    setLiveTasks([]);
    setStreamingReply('');
    setActiveArtifact(null);
    setShowHyperUpgradePrompt(false);
    setConfirmClearSidebar(false);
    if (authUser) {
      await Promise.allSettled(oldIds.map((id) => deleteCloudSession(authUser.uid, id)));
    }
  };

  const handleStartNewChat = () => {
    setActiveSessionId(`chat_${Date.now()}`);
    setMessages([]);
    setDraftInput('');
    setLiveTasks([]);
    setStreamingReply('');
    setActiveArtifact(null);
    navigateToView('command');
  };

  const handleOpenArtifact = (payload: {
    title: string;
    files: GeneratedProjectFile[];
    activePath: string;
    sourceMessageId?: string;
  }) => {
    const clonedFiles = payload.files.map((f) => ({ ...f }));
    const existing = activeArtifactRef.current;
    // If clicking the exact same already-loaded artifact message, preserve its version history
    if (existing && payload.sourceMessageId && existing.sourceMessageId === payload.sourceMessageId) {
      setActiveArtifact({
        ...existing,
        activePath: payload.activePath,
      });
      setSidebarCollapsed(true);
      return;
    }

    const initialVersion: ArtifactVersion = {
      version: 1,
      label: 'v1',
      createdAt: new Date().toISOString(),
      files: clonedFiles.map((f) => ({ ...f })),
      activePath: payload.activePath,
      sourceMessageId: payload.sourceMessageId,
    };

    setActiveArtifact({
      id: `art_${Date.now()}`,
      title: payload.title,
      files: clonedFiles,
      activePath: payload.activePath,
      sourceMessageId: payload.sourceMessageId,
      versions: [initialVersion],
      currentVersion: 1,
    });
    // Auto-collapse desktop left rail so Chat + Workbench sit comfortably side-by-side
    setSidebarCollapsed(true);
  };

  const handleSelectArtifactVersion = (versionNumber: number) => {
    setActiveArtifact((prev) => {
      if (!prev || !Array.isArray(prev.versions)) return prev;
      const target = prev.versions.find((v) => v.version === versionNumber);
      if (!target) return prev;
      const cloned = target.files.map((f) => ({ ...f }));
      const nextActive = cloned.some((f) => f.path === prev.activePath)
        ? prev.activePath
        : cloned[0]?.path ?? prev.activePath;
      return {
        ...prev,
        files: cloned,
        activePath: nextActive,
        currentVersion: target.version,
        sourceMessageId: target.sourceMessageId ?? prev.sourceMessageId,
      };
    });
  };

  const handleSelectModelFromHeader = (choice: ModelChoice) => {
    setModelMenuOpen(false);
    if (choice === 'hyper' && account?.plan !== 'plus') {
      setShowHyperUpgradePrompt(true);
      setActiveView('command');
      return;
    }
    setShowHyperUpgradePrompt(false);
    setModelChoice(choice);
  };

  const handleConnectGmail = async () => {
    setGmailBusy(true);
    setGmailError(null);
    try {
      const res = await signInWithGoogleGmail();
      const email = res.user?.email ?? undefined;
      const displayName = res.user?.displayName ?? undefined;
      await saveGmailServerSession(res.accessToken, email, displayName);
      await Promise.all([refreshStatus(), refreshAccount()]);
    } catch (err) {
      setGmailError(extractErrorDisplay(err).message);
    } finally {
      setGmailBusy(false);
    }
  };

  const handleDisconnectGmail = async () => {
    setGmailBusy(true);
    setGmailError(null);
    try {
      await disconnectGmail();
      await refreshStatus();
    } catch (err) {
      setGmailError(extractErrorDisplay(err).message);
    } finally {
      setGmailBusy(false);
    }
  };

  const handleConnectDrive = async () => {
    setDriveBusy(true);
    setDriveError(null);
    try {
      const res = await signInWithGoogleDrive();
      const email = res.user?.email ?? undefined;
      const displayName = res.user?.displayName ?? undefined;
      await saveDriveServerSession(res.accessToken, email, displayName);
      await Promise.all([refreshStatus(), refreshAccount()]);
    } catch (err) {
      setDriveError(extractErrorDisplay(err).message);
    } finally {
      setDriveBusy(false);
    }
  };

  const handleDisconnectDrive = async () => {
    setDriveBusy(true);
    setDriveError(null);
    try {
      await disconnectDrive();
      await refreshStatus();
    } catch (err) {
      setDriveError(extractErrorDisplay(err).message);
    } finally {
      setDriveBusy(false);
    }
  };

  const handleSendChat = async (
    text: string,
    attachments?: ChatAttachment[],
    options?: {
      updateOpenWorkbench?: boolean;
      modelChoiceOverride?: ModelChoice;
      replaceErrorMessageId?: string;
    }
  ) => {
    const trimmed = text.trim();
    const safeAttachments = Array.isArray(attachments) ? attachments : [];
    if (!trimmed && safeAttachments.length === 0) return;

    const effectiveModelChoice = options?.modelChoiceOverride ?? modelChoice;
    if (options?.modelChoiceOverride && options.modelChoiceOverride !== modelChoice) {
      setModelChoice(options.modelChoiceOverride);
    }

    // Resolve slash Skill command (e.g. /prompt, /luau, /email, /debug, /audit, or custom skill)
    const resolved = resolveSkillInvocation(trimmed, allSkills);
    const effectiveMode = resolved.recommendedMode ?? mode;
    const effectiveDebugLoop = resolved.forceDebugLoop ? true : debugLoop;
    const activeInstructions =
      customInstructions.enabled && customInstructions.text.trim()
        ? clampCustomInstructions(customInstructions.text)
        : undefined;

    if (resolved.recommendedMode && resolved.recommendedMode !== mode) {
      setMode(resolved.recommendedMode);
    }

    const userMessage: ChatMessage = {
      id: `msg_${Date.now()}_u`,
      role: 'user',
      content: resolved.displayContent,
      skillCommand: resolved.matchedSkill?.command,
      mode: effectiveMode,
      modelChoice: effectiveModelChoice,
      fastMode,
      attachments:
        safeAttachments.length > 0
          ? safeAttachments.map((att) => ({
              id: att.id,
              kind: att.kind,
              name: att.name,
              mimeType: att.mimeType,
              size: att.size,
              previewUrl: att.previewUrl,
            }))
          : undefined,
      createdAt: new Date().toISOString(),
    };

    const baseMessages = (Array.isArray(messages) ? messages : []).filter(
      (m) => !options?.replaceErrorMessageId || m.id !== options.replaceErrorMessageId
    );
    const lastBaseMsg = baseMessages[baseMessages.length - 1];
    const reuseLastUserBubble = Boolean(
      options?.replaceErrorMessageId &&
        lastBaseMsg?.role === 'user' &&
        lastBaseMsg.content.trim() === resolved.displayContent.trim()
    );

    const priorHistory = (reuseLastUserBubble ? baseMessages.slice(0, -1) : baseMessages)
      .filter((m) => !m.error && typeof m.content === 'string')
      .map((m) => ({ role: m.role, content: m.content }));

    setMessages((prev) => {
      const cleaned = (Array.isArray(prev) ? prev : []).filter(
        (m) => !options?.replaceErrorMessageId || m.id !== options.replaceErrorMessageId
      );
      if (reuseLastUserBubble) return cleaned;
      return [...cleaned, userMessage];
    });
    setDraftInput('');
    setSending(true);
    setLiveTasks([]);
    setStreamingReply('');

    const openArt = activeArtifactRef.current;
    const explicitNewBuild =
      /\b(start\s+(over|from\s+scratch|fresh)|brand\s+new\s+(website|app|project|site)|completely\s+new|ignore\s+(the\s+)?previous|forget\s+(the\s+)?previous)\b/i.test(
        trimmed
      );
    const activeArtFile =
      openArt && !options?.updateOpenWorkbench && !explicitNewBuild && !resolved.matchedSkill
        ? openArt.files.find((f) => f.path === openArt.activePath) ?? openArt.files[0]
        : undefined;
    const looksLikeArtifactFollowUp = Boolean(
      activeArtFile &&
        /\b(fix|bug|broken|error|issue|not\s+working|doesn'?t\s+work|repair|debug|change|update|edit|modify|adjust|tweak|improve|refine|add|remove|hide|show|move|align|center|color|theme|font|dark\s+mode|light\s+mode|responsive|mobile|navbar|header|footer|button|modal|drawer|menu|form|cart|slider|tab|section|card|layout|make\s+(it|the|this))\b/i.test(
          trimmed
        )
    );
    const apiMessage =
      looksLikeArtifactFollowUp && activeArtFile
        ? `${resolved.expandedPrompt}\n\n[ACTIVE ARTIFACT CONTEXT — Modify this exact current \`${activeArtFile.path}\` in place without rewriting from scratch or omitting lines. Return the COMPLETE updated \`${activeArtFile.path}\` file.]\n\`\`\`${activeArtFile.language}:${activeArtFile.path}\n${activeArtFile.content}\n\`\`\``
        : resolved.expandedPrompt;

    try {
      const result = await sendAgentChatStream(
        {
          message: apiMessage,
          mode: effectiveMode,
          modelChoice: effectiveModelChoice,
          fastMode,
          debugLoop: effectiveDebugLoop,
          memoryEnabled,
          customInstructions: activeInstructions,
          skipAutoCodeVerify: resolved.skipAutoCodeVerify,
          attachments: safeAttachments,
          history: priorHistory,
        },
        {
          onTask: (task) => {
            setLiveTasks((prev) => {
              const idx = prev.findIndex((t) => t.id === task.id);
              if (idx >= 0) {
                const next = [...prev];
                next[idx] = task;
                return next;
              }
              return [...prev, task];
            });
          },
          onDelta: (chunkText) => {
            setStreamingReply((prev) => prev + chunkText);
          },
          onReplace: (fullText) => {
            setStreamingReply(fullText);
          },
          onMemory: (fact) => {
            setMemoryFacts((prev) => {
              if (prev.some((f) => f.id === fact.id)) return prev;
              return [fact, ...prev];
            });
            if (authUser) {
              void saveCloudMemoryFact(authUser.uid, fact).catch(() => {});
            }
          },
        }
      );

      const createdActions = Array.isArray(result?.createdActions) ? result.createdActions : [];
      const toolsUsed = Array.isArray(result?.toolsUsed) ? result.toolsUsed : [];
      const injectionAlerts = Array.isArray(result?.injectionAlerts) ? result.injectionAlerts : [];
      const taskSteps = Array.isArray(result?.tasks) ? result.tasks : [];
      const replyText =
        typeof result?.reply === 'string' && result.reply.trim()
          ? result.reply
          : createdActions.length > 0
            ? 'Prepared an action preview below. Review it and click Approve & Execute when ready.'
            : 'Completed request with no additional output.';

      if (createdActions.length > 0) {
        setActions((prev) => [...createdActions, ...(Array.isArray(prev) ? prev : [])]);
      }

      if (Array.isArray(result?.savedMemories) && result.savedMemories.length > 0 && !authUser) {
        void refreshMemory();
      }

      const currentUid = authUserRef.current?.uid;
      if (currentUid) {
        // Atomically increment usage in Firebase Firestore first so restarts or iframe cookie blocks never lose usage
        void incrementCloudUsageWindow(currentUid)
          .then((persisted) => {
            setAccount((prev) => {
              const limit = getWindowMessageLimit(prev.plan, 'google');
              return {
                ...prev,
                usage: {
                  used: persisted.used,
                  limit,
                  remaining: limit === null ? null : Math.max(0, limit - persisted.used),
                  windowDurationHours: USAGE_WINDOW_HOURS,
                  windowStartedAtMs: persisted.windowStartedAtMs,
                  resetsAt: persisted.resetsAt,
                },
              };
            });
            if (persisted.windowStartedAtMs > 0 && persisted.used > 0) {
              void hydrateServerUsage(persisted.windowStartedAtMs, persisted.used).catch(() => {});
            }
          })
          .catch(() => {
            if (result?.usage) {
              setAccount((prev) => ({ ...prev, usage: result.usage! }));
            }
          });
      } else if (result?.usage) {
        setAccount((prev) => ({ ...prev, usage: result.usage! }));
      } else {
        void refreshAccount();
      }

      void stripAttachmentPayloadsForHistory(safeAttachments);

      const assistantMsgId = `msg_${Date.now()}_a`;
      const assistantMessage: ChatMessage = {
        id: assistantMsgId,
        role: 'assistant',
        content: replyText,
        mode: effectiveMode,
        modelChoice: result?.modelChoice ?? modelChoice,
        modelLabel: result?.modelLabel,
        fastMode: result?.fastMode ?? fastMode,
        selfReviewApplied: result?.selfReviewApplied,
        codeVerification: result?.codeVerification,
        webSources: result?.webSources,
        searchQueries: result?.searchQueries,
        elapsedMs: result?.elapsedMs,
        tasks: taskSteps,
        createdAt: new Date().toISOString(),
        actionIds: createdActions.map((a) => a.id),
        toolsUsed,
        injectionAlerts,
      };
      setMessages((prev) => [...(Array.isArray(prev) ? prev : []), assistantMessage]);

      // Claude-Style Interactive Website Artifacts: auto-open split-pane Workbench on desktop
      // (and always update when refining an already-open Workbench), tracking v1/v2/v3 version history
      const detectedWebsite = detectWebsiteArtifact(replyText);
      const isDesktopViewport = typeof window !== 'undefined' && window.innerWidth >= 1024;
      const shouldSyncArtifact =
        (options?.updateOpenWorkbench && Boolean(activeArtifactRef.current)) ||
        (Boolean(detectedWebsite) && (isDesktopViewport || Boolean(activeArtifactRef.current)));

      if (shouldSyncArtifact) {
        const extracted = detectedWebsite?.files ?? extractProjectFiles(replyText);
        if (extracted.length > 0) {
          const prevArt = activeArtifactRef.current;
          const prevPath = prevArt?.activePath;
          const nextActive =
            prevPath && extracted.some((f) => f.path === prevPath)
              ? prevPath
              : detectedWebsite?.activePath ?? extracted[0].path;
          const nextTitle =
            detectedWebsite?.title ??
            (extracted.length > 1 ? 'Interactive Project' : extracted[0].path);

          const isIteratingSameArtifact = Boolean(
            prevArt && (options?.updateOpenWorkbench || detectedWebsite)
          );
          const prevVersions: ArtifactVersion[] =
            isIteratingSameArtifact && prevArt
              ? prevArt.versions && prevArt.versions.length > 0
                ? prevArt.versions
                : [
                    {
                      version: 1,
                      label: 'v1',
                      createdAt: new Date().toISOString(),
                      files: prevArt.files.map((f) => ({ ...f })),
                      activePath: prevArt.activePath,
                      sourceMessageId: prevArt.sourceMessageId,
                    },
                  ]
              : [];
          const nextVersionNum = prevVersions.length + 1;
          const newVersion: ArtifactVersion = {
            version: nextVersionNum,
            label: `v${nextVersionNum}`,
            createdAt: new Date().toISOString(),
            files: extracted.map((f) => ({ ...f })),
            activePath: nextActive,
            sourceMessageId: assistantMsgId,
          };

          setActiveArtifact({
            id: isIteratingSameArtifact && prevArt ? prevArt.id : `art_${Date.now()}`,
            title: nextTitle,
            files: extracted.map((f) => ({ ...f })),
            activePath: nextActive,
            sourceMessageId: assistantMsgId,
            versions: [...prevVersions, newVersion],
            currentVersion: nextVersionNum,
          });
          setSidebarCollapsed(true);
        }
      }
    } catch (err) {
      const display = extractErrorDisplay(err);
      setMessages((prev) => [
        ...(Array.isArray(prev) ? prev : []),
        {
          id: `msg_${Date.now()}_err`,
          role: 'assistant',
          content: display.message,
          errorTitle: display.title,
          errorCode: display.code,
          retryAfterSec: display.retryAfterSec,
          retryAttempts: display.attemptsMade,
          retryPrompt: trimmed || undefined,
          mode: effectiveMode,
          modelChoice: effectiveModelChoice,
          createdAt: new Date().toISOString(),
          error: true,
        },
      ]);
      void refreshAccount();
    } finally {
      setSending(false);
      setLiveTasks([]);
      setStreamingReply('');
    }
  };

  const handleRefineArtifactWithAi = (instruction: string, activeFile: GeneratedProjectFile) => {
    const prompt = `Refine \`${activeFile.path}\` (${activeFile.language}) according to this request: ${instruction}\n\nReturn the complete updated file(s) in fenced code blocks.\n\nCurrent code for \`${activeFile.path}\`:\n\`\`\`${activeFile.language}:${activeFile.path}\n${activeFile.content}\n\`\`\``;
    void handleSendChat(prompt, [], { updateOpenWorkbench: true });
  };

  const handleApproveAction = async (id: string) => {
    const updated = await approveAction(id);
    setActions((prev) => (Array.isArray(prev) ? prev : []).map((a) => (a.id === id ? updated : a)));
  };

  const handleRejectAction = async (id: string) => {
    const updated = await rejectAction(id);
    setActions((prev) => (Array.isArray(prev) ? prev : []).map((a) => (a.id === id ? updated : a)));
  };

  const handleQueueDraft = async (draft: {
    to: string;
    subject: string;
    body: string;
    language: string;
  }) => {
    const created = await queueManualAction({
      type: 'gmail_create_draft',
      title: `Save Gmail draft to ${draft.to || 'recipient'}`,
      summary: `Subject: ${draft.subject || '(No subject)'} (${draft.language})`,
      payload: draft,
      previewText: `To: ${draft.to}\nSubject: ${draft.subject}\nLanguage: ${draft.language}\n\n${draft.body}`,
      riskLevel: 'standard',
    });
    setActions((prev) => [created, ...(Array.isArray(prev) ? prev : [])]);
    setActiveView('approvals');
  };

  const handleQueueSaveToDrive = async (file: { name: string; content: string }) => {
    const created = await queueManualAction({
      type: 'drive_save_file',
      title: `Save "${file.name}" to Google Drive (IND AGENT)`,
      summary: `Folder: IND AGENT · ${file.content.length} chars`,
      payload: {
        name: file.name,
        content: file.content,
        mimeType: 'text/plain',
      },
      previewText: `Folder: IND AGENT\nFile: ${file.name}\n\n${file.content.slice(0, 3500)}${
        file.content.length > 3500 ? '\n... (truncated in preview)' : ''
      }`,
      riskLevel: 'standard',
    });
    setActions((prev) => [created, ...(Array.isArray(prev) ? prev : [])]);
    setActiveView('approvals');
  };

  const handleQueueDriveUpdate = async (file: {
    fileId: string;
    name: string;
    content: string;
  }) => {
    const created = await queueManualAction({
      type: 'drive_update_file',
      title: `Overwrite "${file.name}" in Google Drive`,
      summary: `File ID: ${file.fileId} · ${file.content.length} chars`,
      payload: {
        fileId: file.fileId,
        name: file.name,
        content: file.content,
        mimeType: 'text/plain',
      },
      previewText: `Overwrite file in Google Drive\nFile: ${file.name} (${file.fileId})\n\n${file.content.slice(
        0,
        3500
      )}${file.content.length > 3500 ? '\n... (truncated in preview)' : ''}`,
      riskLevel: 'elevated',
      warning: 'This will overwrite the existing content of the file in Google Drive.',
    });
    setActions((prev) => [created, ...(Array.isArray(prev) ? prev : [])]);
    setActiveView('approvals');
  };

  const handleQueueDriveDelete = async (file: { fileId: string; name: string }) => {
    const created = await queueManualAction({
      type: 'drive_delete_file',
      title: `Move "${file.name}" to Google Drive Trash`,
      summary: `File ID: ${file.fileId}`,
      payload: {
        fileId: file.fileId,
        name: file.name,
      },
      previewText: `Move file to Google Drive Trash\nFile: ${file.name}\nFile ID: ${file.fileId}`,
      riskLevel: 'elevated',
      warning: 'This will move the file to your Google Drive Trash.',
    });
    setActions((prev) => [created, ...(Array.isArray(prev) ? prev : [])]);
    setActiveView('approvals');
  };

  const handleAddTask = (input: Omit<BusinessTask, 'id' | 'createdAt' | 'status'>) => {
    const created: BusinessTask = {
      ...input,
      id: `task_${Date.now()}`,
      status: 'open',
      createdAt: new Date().toISOString(),
    };
    setTasks((prev) => [created, ...(Array.isArray(prev) ? prev : [])]);
  };

  const handleCycleTaskStatus = (id: string) => {
    setTasks((prev) =>
      (Array.isArray(prev) ? prev : []).map((t) => {
        if (t.id !== id) return t;
        const next =
          t.status === 'open' ? 'in_progress' : t.status === 'in_progress' ? 'done' : 'open';
        return { ...t, status: next };
      })
    );
  };

  const handleRemoveTask = (id: string) => {
    setTasks((prev) => (Array.isArray(prev) ? prev : []).filter((t) => t.id !== id));
  };

  const handleSendPromptToAgent = (
    prompt: string,
    targetMode: 'coding' | 'business' = 'business'
  ) => {
    setMode(targetMode);
    setDraftInput(prompt);
    setActiveView('command');
    setMobileNavOpen(false);
  };

  const safeActions = Array.isArray(actions) ? actions : [];
  const safeTasks = Array.isArray(tasks) ? tasks : [];
  const pendingCount = safeActions.filter((a) => a.status === 'pending').length;
  const openTasksCount = safeTasks.filter((t) => t.status !== 'done').length;

  const isPlus = account?.plan === 'plus';
  const isGuest = !authUser && account?.authType === 'guest';
  const usageUsed = account?.usage?.used ?? 0;
  const usageLimit =
    account?.usage?.limit ??
    (isGuest ? GUEST_WINDOW_MESSAGE_LIMIT : SIGNED_IN_WINDOW_MESSAGE_LIMIT);
  const usagePct = isPlus
    ? 0
    : Math.min(100, Math.round((usageUsed / Math.max(1, usageLimit)) * 100));
  const customInstructionsActive = Boolean(
    customInstructions.enabled && customInstructions.text.trim()
  );

  const profileDisplayName = authUser?.displayName || 'Guest Workspace';
  const profileInitials = getInitials(authUser?.displayName || 'IND AGENT');
  const profileTierLabel = isPlus
    ? 'PLUS'
    : isGuest
      ? `GUEST · ${usageUsed}/${usageLimit}`
      : `FREE · ${usageUsed}/${usageLimit}`;

  const filteredSidebarSessions = useMemo(() => {
    const q = sidebarSearchQuery.trim().toLowerCase();
    return sessions.filter((s) => {
      if (sidebarModeFilter !== 'all' && s.mode !== sidebarModeFilter) return false;
      if (q && !s.title.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [sessions, sidebarSearchQuery, sidebarModeFilter]);

  const cycleSidebarModeFilter = () => {
    setSidebarModeFilter((prev) =>
      prev === 'all' ? 'coding' : prev === 'coding' ? 'business' : 'all'
    );
  };

  /** Shared Pure-White Sidebar Contents (Exact Reference Screenshot 1 Layout) */
  const renderExpandedSidebarContent = (isMobile: boolean) => (
    <>
      {/* Top Row: IND AGENT + Search + Close/Collapse */}
      <div className="flex h-16 shrink-0 items-center justify-between px-5">
        <span className="font-display text-[22px] font-normal tracking-normal text-[#1F1F1F] dark:text-[#E3E3E3]">
          IND AGENT
        </span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => {
              setSidebarSearchOpen((open) => {
                if (open) setSidebarSearchQuery('');
                return !open;
              });
            }}
            aria-label="Search chats"
            aria-pressed={sidebarSearchOpen}
            className={`inline-flex h-10 w-10 items-center justify-center rounded-full transition-colors ${
              sidebarSearchOpen
                ? 'bg-[#E8F0FE] dark:bg-[#004A77]/60 text-[#1A73E8] dark:text-[#C2E7FF]'
                : 'text-[#1F1F1F] dark:text-[#E3E3E3] hover:bg-[#F2F3F5] dark:hover:bg-[#282A2C]'
            }`}
          >
            <Search className="h-[20px] w-[20px]" strokeWidth={1.8} />
          </button>
          <button
            type="button"
            onClick={() =>
              isMobile ? setMobileNavOpen(false) : setSidebarCollapsed(true)
            }
            aria-label={isMobile ? 'Close navigation menu' : 'Collapse sidebar'}
            className="inline-flex h-10 w-10 items-center justify-center rounded-full text-[#1F1F1F] dark:text-[#E3E3E3] hover:bg-[#F2F3F5] dark:hover:bg-[#282A2C] transition-colors"
          >
            <X className="h-[20px] w-[20px]" strokeWidth={1.8} />
          </button>
        </div>
      </div>

      {/* Inline Search Input when Search icon toggled */}
      {sidebarSearchOpen && (
        <div className="px-4 pb-3 shrink-0">
          <div className="flex items-center gap-2 rounded-full bg-[#F2F3F5] dark:bg-[#282A2C] px-3.5 py-2">
            <Search className="h-4 w-4 shrink-0 text-[#5F6368] dark:text-[#9AA0A6]" />
            <input
              type="text"
              value={sidebarSearchQuery}
              onChange={(e) => setSidebarSearchQuery(e.target.value)}
              placeholder="Search chats..."
              aria-label="Filter recent chats"
              autoFocus
              className="min-w-0 flex-1 bg-transparent text-sm text-[#1F1F1F] dark:text-[#E3E3E3] placeholder:text-[#5F6368] focus:outline-none"
            />
            {sidebarSearchQuery && (
              <button
                type="button"
                onClick={() => setSidebarSearchQuery('')}
                aria-label="Clear search"
                className="text-[#5F6368] hover:text-[#1F1F1F] dark:hover:text-white"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>
      )}

      {/* Primary Soft-Gray Full-Width 'New chat' Pill */}
      <div className="px-3.5 pb-2 shrink-0">
        <button
          type="button"
          onClick={handleStartNewChat}
          className="flex h-12 w-full items-center gap-4 rounded-full bg-[#F2F3F5] dark:bg-[#282A2C] px-4 text-[15px] font-normal text-[#1F1F1F] dark:text-[#E3E3E3] hover:bg-[#E8EAED] dark:hover:bg-[#333537] transition-colors"
        >
          <ComposeCircleIcon />
          <span>New chat</span>
        </button>
      </div>

      {/* Scrollable Clean Navigation + Workspace + Recent Chats */}
      <div className="flex-1 overflow-y-auto px-3.5 pb-4">
        {/* Primary Feature List matching Screenshot 1 (Library / Images / Scheduled / Customise / Videos rhythm) */}
        <nav className="space-y-0.5 pt-1" aria-label={isMobile ? 'Mobile workspace navigation' : 'Workspace navigation'}>
          <button
            type="button"
            onClick={() => {
              if (isMobile) setMobileNavOpen(false);
              setSkillsModalOpen(true);
            }}
            className="flex h-11 w-full items-center justify-between gap-3 rounded-full px-4 text-[15px] font-normal text-[#1F1F1F] dark:text-[#E3E3E3] hover:bg-[#F2F3F5] dark:hover:bg-[#282A2C] transition-colors"
          >
            <span className="inline-flex items-center gap-4 min-w-0">
              <LayoutGrid className="h-5 w-5 shrink-0" strokeWidth={1.75} aria-hidden="true" />
              <span className="truncate">Skills</span>
            </span>
            <span className="font-mono text-xs text-[#5F6368] dark:text-[#9AA0A6] tabular-nums">
              {allSkills.length}
            </span>
          </button>

          <button
            type="button"
            onClick={() => navigateToView('approvals')}
            className={`flex h-11 w-full items-center justify-between gap-3 rounded-full px-4 text-[15px] transition-colors ${
              activeView === 'approvals'
                ? 'bg-[#E8F0FE] dark:bg-[#004A77]/60 font-medium text-[#041E49] dark:text-[#C2E7FF]'
                : 'font-normal text-[#1F1F1F] dark:text-[#E3E3E3] hover:bg-[#F2F3F5] dark:hover:bg-[#282A2C]'
            }`}
          >
            <span className="inline-flex items-center gap-4 min-w-0">
              <CheckSquare className="h-5 w-5 shrink-0" strokeWidth={1.75} aria-hidden="true" />
              <span className="truncate">Approvals</span>
            </span>
            {pendingCount > 0 && (
              <span className="font-mono text-xs font-medium text-[#1A73E8] dark:text-[#8AB4F8] tabular-nums">
                {pendingCount}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => navigateToView('tools')}
            className={`flex h-11 w-full items-center justify-between gap-3 rounded-full px-4 text-[15px] transition-colors ${
              activeView === 'tools'
                ? 'bg-[#E8F0FE] dark:bg-[#004A77]/60 font-medium text-[#041E49] dark:text-[#C2E7FF]'
                : 'font-normal text-[#1F1F1F] dark:text-[#E3E3E3] hover:bg-[#F2F3F5] dark:hover:bg-[#282A2C]'
            }`}
          >
            <span className="inline-flex items-center gap-4 min-w-0">
              <Clock className="h-5 w-5 shrink-0" strokeWidth={1.75} aria-hidden="true" />
              <span className="truncate">Tools</span>
            </span>
          </button>

          <button
            type="button"
            onClick={() => {
              navigateToView('command');
              setContextDrawerOpen(true);
            }}
            aria-label="Open Memory and Approval Queue"
            className="flex h-11 w-full items-center justify-between gap-3 rounded-full px-4 text-[15px] font-normal text-[#1F1F1F] dark:text-[#E3E3E3] hover:bg-[#F2F3F5] dark:hover:bg-[#282A2C] transition-colors"
          >
            <span className="inline-flex items-center gap-4 min-w-0">
              <Hexagon className="h-5 w-5 shrink-0" strokeWidth={1.75} aria-hidden="true" />
              <span className="truncate">Memory &amp; Queue</span>
            </span>
            {(pendingCount > 0 || memoryFacts.length > 0) && (
              <span className="font-mono text-xs text-[#5F6368] dark:text-[#9AA0A6] tabular-nums">
                {pendingCount > 0 ? pendingCount : memoryFacts.length}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => navigateToView('business')}
            className={`flex h-11 w-full items-center justify-between gap-3 rounded-full px-4 text-[15px] transition-colors ${
              activeView === 'business'
                ? 'bg-[#E8F0FE] dark:bg-[#004A77]/60 font-medium text-[#041E49] dark:text-[#C2E7FF]'
                : 'font-normal text-[#1F1F1F] dark:text-[#E3E3E3] hover:bg-[#F2F3F5] dark:hover:bg-[#282A2C]'
            }`}
          >
            <span className="inline-flex items-center gap-4 min-w-0">
              <Briefcase className="h-5 w-5 shrink-0" strokeWidth={1.75} aria-hidden="true" />
              <span className="truncate">Business Ops</span>
            </span>
            {openTasksCount > 0 && (
              <span className="font-mono text-xs text-[#5F6368] dark:text-[#9AA0A6] tabular-nums">
                {openTasksCount}
              </span>
            )}
          </button>
        </nav>

        {/* Chats Section placed above Workspace */}
        <div className="pt-6">
          <div className="flex items-center justify-between px-4 pb-2">
            <div className="flex items-center gap-2 text-[14px] font-normal text-[#5F6368] dark:text-[#9AA0A6]">
              <span>
                {sidebarModeFilter === 'all'
                  ? 'Chats'
                  : sidebarModeFilter === 'coding'
                    ? 'Chats · Coding'
                    : 'Chats · Business'}
              </span>
              {sessions.length > 1 &&
                (confirmClearSidebar ? (
                  <span className="inline-flex items-center gap-1.5 text-xs">
                    <button
                      type="button"
                      onClick={() => void handleClearAllChats()}
                      className="font-semibold text-[#D93025] hover:underline"
                    >
                      Confirm
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmClearSidebar(false)}
                      className="text-[#5F6368] hover:underline"
                    >
                      Cancel
                    </button>
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmClearSidebar(true)}
                    className="text-xs text-[#5F6368] hover:text-[#D93025] transition-colors"
                  >
                    · Clear
                  </button>
                ))}
            </div>
            <button
              type="button"
              onClick={cycleSidebarModeFilter}
              aria-label={`Filter chats (current: ${sidebarModeFilter})`}
              title={`Filter chats (${sidebarModeFilter}) — click to cycle`}
              className={`inline-flex h-8 w-8 items-center justify-center rounded-full transition-colors ${
                sidebarModeFilter !== 'all'
                  ? 'bg-[#E8F0FE] dark:bg-[#004A77]/60 text-[#1A73E8] dark:text-[#C2E7FF]'
                  : 'text-[#5F6368] dark:text-[#9AA0A6] hover:bg-[#F2F3F5] dark:hover:bg-[#282A2C]'
              }`}
            >
              <Filter className="h-[18px] w-[18px]" strokeWidth={1.75} />
            </button>
          </div>

          {filteredSidebarSessions.length === 0 ? (
            <p className="px-4 py-1 text-[14px] text-[#747775] dark:text-[#8E918F]">
              {sessions.length === 0
                ? 'Your chats will appear here.'
                : 'No matching chats.'}
            </p>
          ) : (
            <ul className="space-y-0.5">
              {filteredSidebarSessions.slice(0, 14).map((s) => {
                const isActive = s.id === activeSessionId && activeView === 'command';
                return (
                  <li key={s.id} className="group flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => handleSelectSession(s)}
                      title={s.title}
                      className={`flex h-11 min-w-0 flex-1 items-center rounded-full px-4 text-left text-[15px] transition-colors ${
                        isActive
                          ? 'bg-[#E8F0FE] dark:bg-[#004A77]/60 font-medium text-[#041E49] dark:text-[#C2E7FF]'
                          : 'font-normal text-[#1F1F1F] dark:text-[#E3E3E3] hover:bg-[#F2F3F5] dark:hover:bg-[#282A2C]'
                      }`}
                    >
                      <span className="truncate">{s.title}</span>
                    </button>
                    <button
                      type="button"
                      aria-label={`Delete chat ${s.title}`}
                      title={`Delete chat "${s.title}"`}
                      onClick={() => void handleDeleteSession(s.id)}
                      className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[#5F6368] opacity-55 group-hover:opacity-100 focus-visible:opacity-100 hover:bg-[#FCE8E6] dark:hover:bg-[#3B1E1D] hover:text-[#D93025] transition-all"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Workspace Section below Chats */}
        <div className="pt-6">
          <div className="px-4 pb-2 text-[14px] font-normal text-[#5F6368] dark:text-[#9AA0A6]">
            Workspace
          </div>
          <div className="space-y-0.5">
            <button
              type="button"
              onClick={() => {
                if (isMobile) setMobileNavOpen(false);
                setSkillsModalOpen(true);
              }}
              className="flex h-11 w-full items-center gap-4 rounded-full px-4 text-[15px] font-normal text-[#1F1F1F] dark:text-[#E3E3E3] hover:bg-[#F2F3F5] dark:hover:bg-[#282A2C] transition-colors"
            >
              <Plus className="h-5 w-5 shrink-0" strokeWidth={1.75} aria-hidden="true" />
              <span className="truncate">New custom skill</span>
            </button>

            <button
              type="button"
              data-testid="sidebar-usage-meter"
              onClick={() => navigateToView('plans')}
              className={`flex w-full flex-col gap-1.5 rounded-2xl px-4 py-2.5 text-left transition-colors ${
                activeView === 'plans'
                  ? 'bg-[#E8F0FE] dark:bg-[#004A77]/60 text-[#041E49] dark:text-[#C2E7FF]'
                  : 'text-[#1F1F1F] dark:text-[#E3E3E3] hover:bg-[#F2F3F5] dark:hover:bg-[#282A2C]'
              }`}
            >
              <div className="flex w-full items-center justify-between gap-2">
                <span className="inline-flex items-center gap-4 min-w-0 text-[15px] font-normal">
                  <BookOpen className="h-5 w-5 shrink-0" strokeWidth={1.75} aria-hidden="true" />
                  <span className="truncate">Plans &amp; Usage</span>
                </span>
                <span className="shrink-0 font-mono text-xs font-medium text-[#5F6368] dark:text-[#9AA0A6] tabular-nums">
                  {isPlus ? '∞' : `${usageUsed} / ${usageLimit}`}
                </span>
              </div>
              {!isPlus && (
                <div className="ml-9 h-1 w-[calc(100%-2.25rem)] overflow-hidden rounded-full bg-[#E8EDF4] dark:bg-[#2E3033]">
                  <div
                    className={`h-full rounded-full transition-all duration-300 ${
                      usagePct >= 95
                        ? 'bg-[#D93025]'
                        : usagePct >= 80
                          ? 'bg-[#F9AB00]'
                          : 'bg-[#1A73E8] dark:bg-[#8AB4F8]'
                    }`}
                    style={{ width: `${usagePct}%` }}
                  />
                </div>
              )}
            </button>

            <button
              type="button"
              onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
              aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
              className="flex h-11 w-full items-center gap-4 rounded-full px-4 text-[15px] font-normal text-[#1F1F1F] dark:text-[#E3E3E3] hover:bg-[#F2F3F5] dark:hover:bg-[#282A2C] transition-colors"
            >
              {theme === 'dark' ? (
                <Sun className="h-5 w-5 shrink-0" strokeWidth={1.75} aria-hidden="true" />
              ) : (
                <Moon className="h-5 w-5 shrink-0" strokeWidth={1.75} aria-hidden="true" />
              )}
              <span className="truncate">{theme === 'dark' ? 'Light mode' : 'Dark mode'}</span>
            </button>
          </div>
        </div>
      </div>

      {/* Sticky Bottom Profile + Settings Gear Footer (Exact Reference Screenshot 1) */}
      <div className="flex shrink-0 items-center justify-between gap-2 bg-white dark:bg-[#1E1F20] px-4 py-3.5 border-t border-[#F4F5F7] dark:border-[#2A2C2E]">
        <button
          type="button"
          onClick={() => {
            if (isMobile) setMobileNavOpen(false);
            setAccountSheetOpen(true);
          }}
          aria-label="Open account menu"
          className="flex min-w-0 flex-1 items-center gap-3 rounded-2xl p-1 text-left hover:bg-[#F2F3F5] dark:hover:bg-[#282A2C] transition-colors"
        >
          {/* Signature Blue-Ringed Avatar */}
          <span className="shrink-0 rounded-full bg-gradient-to-tr from-[#3B82F6] via-[#60A5FA] to-[#818CF8] p-[2px]">
            <span className="block rounded-full bg-white dark:bg-[#1E1F20] p-[1.5px]">
              {authUser?.photoURL ? (
                <img
                  src={authUser.photoURL}
                  alt={profileDisplayName}
                  referrerPolicy="no-referrer"
                  className="h-9 w-9 rounded-full object-cover"
                />
              ) : (
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[#689F38] text-[14px] font-medium text-white">
                  {profileInitials}
                </span>
              )}
            </span>
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[15px] font-normal leading-tight text-[#1F1F1F] dark:text-[#E3E3E3]">
              {profileDisplayName}
            </div>
            <div className="mt-0.5 truncate text-[12px] tracking-wide uppercase text-[#5F6368] dark:text-[#9AA0A6] tabular-nums">
              {profileTierLabel}
            </div>
          </div>
        </button>

        <button
          type="button"
          onClick={() => {
            if (isMobile) setMobileNavOpen(false);
            setSettingsModalOpen(true);
          }}
          title="Settings & Custom Instructions"
          aria-label="Open Settings"
          className="relative inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[#444746] dark:text-[#C4C7C5] hover:bg-[#F2F3F5] dark:hover:bg-[#282A2C] transition-colors"
        >
          <Settings className="h-[22px] w-[22px]" strokeWidth={1.6} />
          {customInstructionsActive && (
            <span
              title="Custom instructions active"
              className="absolute right-2 top-2 h-2 w-2 rounded-full bg-[#188038] dark:bg-[#81C995]"
            />
          )}
        </button>
      </div>
    </>
  );

  return (
    <div className="flex h-screen w-full overflow-hidden bg-white dark:bg-[#131314] text-[#1F1F1F] dark:text-[#E3E3E3]">
      {/* Pure-White Collapsible Desktop Left Sidebar (Reference Screenshot 1) */}
      <aside
        className={`hidden lg:flex shrink-0 flex-col border-r border-[#F0F2F5] dark:border-[#2A2C2E] bg-white dark:bg-[#1E1F20] transition-[width] duration-200 ${
          sidebarCollapsed ? 'w-[68px]' : 'w-[296px]'
        }`}
      >
        {sidebarCollapsed ? (
          <div className="flex h-full flex-col items-center justify-between py-3">
            <div className="flex flex-col items-center gap-2">
              <button
                type="button"
                onClick={() => setSidebarCollapsed(false)}
                aria-label="Expand sidebar"
                className="inline-flex h-10 w-10 items-center justify-center rounded-full text-[#1F1F1F] dark:text-[#E3E3E3] hover:bg-[#F2F3F5] dark:hover:bg-[#282A2C] transition-colors"
              >
                <TwoBarMenuIcon />
              </button>
              <button
                type="button"
                onClick={handleStartNewChat}
                aria-label="New chat"
                title="New chat"
                className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-[#F2F3F5] dark:bg-[#282A2C] text-[#1F1F1F] dark:text-[#E3E3E3] hover:bg-[#E8EAED] dark:hover:bg-[#333537] transition-colors"
              >
                <ComposeCircleIcon />
              </button>
              <button
                type="button"
                onClick={() => setSkillsModalOpen(true)}
                aria-label="Skills"
                title="Skills"
                className="inline-flex h-10 w-10 items-center justify-center rounded-full text-[#444746] dark:text-[#C4C7C5] hover:bg-[#F2F3F5] dark:hover:bg-[#282A2C] transition-colors"
              >
                <LayoutGrid className="h-5 w-5" strokeWidth={1.75} />
              </button>
              <button
                type="button"
                onClick={() => navigateToView('approvals')}
                aria-label="Approvals"
                title="Approvals"
                className="inline-flex h-10 w-10 items-center justify-center rounded-full text-[#444746] dark:text-[#C4C7C5] hover:bg-[#F2F3F5] dark:hover:bg-[#282A2C] transition-colors"
              >
                <CheckSquare className="h-5 w-5" strokeWidth={1.75} />
              </button>
              <button
                type="button"
                onClick={() => navigateToView('plans')}
                aria-label={isPlus ? 'Plus Unlimited usage' : `5-hour usage ${usageUsed} of ${usageLimit}`}
                title={isPlus ? 'Plus · Unlimited' : `5-hour usage: ${usageUsed} / ${usageLimit}`}
                className="inline-flex h-10 w-10 flex-col items-center justify-center rounded-full bg-[#F2F3F5] dark:bg-[#282A2C] font-mono text-[10px] font-semibold text-[#1F1F1F] dark:text-[#E3E3E3] hover:bg-[#E8EAED] dark:hover:bg-[#333537] transition-colors"
              >
                <span>{isPlus ? '∞' : usageUsed}</span>
                {!isPlus && (
                  <span className="text-[8px] text-[#5F6368] dark:text-[#9AA0A6]">/{usageLimit}</span>
                )}
              </button>
            </div>

            <div className="flex flex-col items-center gap-2.5">
              <button
                type="button"
                onClick={() => setSettingsModalOpen(true)}
                aria-label="Open Settings"
                title="Settings"
                className="inline-flex h-10 w-10 items-center justify-center rounded-full text-[#444746] dark:text-[#C4C7C5] hover:bg-[#F2F3F5] dark:hover:bg-[#282A2C] transition-colors"
              >
                <Settings className="h-5 w-5" strokeWidth={1.7} />
              </button>
              <button
                type="button"
                onClick={() => setAccountSheetOpen(true)}
                aria-label="Open account menu"
                title={profileDisplayName}
                className="rounded-full bg-gradient-to-tr from-[#3B82F6] via-[#60A5FA] to-[#818CF8] p-[2px]"
              >
                <span className="block rounded-full bg-white dark:bg-[#1E1F20] p-[1.5px]">
                  {authUser?.photoURL ? (
                    <img
                      src={authUser.photoURL}
                      alt={profileDisplayName}
                      referrerPolicy="no-referrer"
                      className="h-8 w-8 rounded-full object-cover"
                    />
                  ) : (
                    <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#689F38] text-xs font-medium text-white">
                      {profileInitials}
                    </span>
                  )}
                </span>
              </button>
            </div>
          </div>
        ) : (
          renderExpandedSidebarContent(false)
        )}
      </aside>

      {/* Pure-White Mobile Navigation Drawer (Exact Reference Screenshot 1) */}
      {mobileNavOpen && (
        <div
          className="fixed inset-0 z-40 flex lg:hidden"
          role="dialog"
          aria-modal="true"
          aria-label="Navigation menu"
        >
          <div
            className="fixed inset-0 bg-black/35 backdrop-blur-[1px]"
            onClick={() => setMobileNavOpen(false)}
          />
          <aside className="relative z-10 flex h-full w-full sm:max-w-[360px] flex-col bg-white dark:bg-[#1E1F20] shadow-2xl">
            {renderExpandedSidebarContent(true)}
          </aside>
        </div>
      )}

      {/* Main Content Shell */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Ultra-Minimalist Top Bar (Exact Reference Screenshot 3) */}
        <header className="flex h-16 shrink-0 items-center justify-between gap-2 bg-white dark:bg-[#131314] px-3.5 sm:px-6">
          <div className="flex items-center gap-1.5 min-w-0">
            {/* Mobile 2-Bar '=' Menu Trigger */}
            <button
              type="button"
              onClick={() => setMobileNavOpen(true)}
              aria-label="Open navigation menu"
              className="inline-flex h-11 w-11 items-center justify-center rounded-full text-[#1F1F1F] dark:text-[#E3E3E3] hover:bg-[#F2F3F5] dark:hover:bg-[#282A2C] lg:hidden shrink-0 transition-colors"
            >
              <TwoBarMenuIcon />
            </button>

            {/* Brand + Muted Model Label + Chevron Dropdown */}
            <div ref={modelMenuRef} className="relative min-w-0">
              <button
                type="button"
                onClick={() => setModelMenuOpen((o) => !o)}
                aria-expanded={modelMenuOpen}
                aria-haspopup="menu"
                className="inline-flex items-center gap-1.5 rounded-xl px-2 py-1.5 text-left hover:bg-[#F2F3F5] dark:hover:bg-[#282A2C] transition-colors"
              >
                <span className="font-display text-[19px] font-normal tracking-normal text-[#1F1F1F] dark:text-[#E3E3E3] whitespace-nowrap">
                  IND AGENT
                </span>
                <span className="text-[19px] font-normal text-[#747775] dark:text-[#9AA0A6] whitespace-nowrap">
                  {modelChoice === 'hyper' ? 'Hyper' : 'Standard'}
                </span>
                <ChevronDown className="h-4 w-4 shrink-0 text-[#5F6368] dark:text-[#9AA0A6]" />
              </button>

              {modelMenuOpen && (
                <div
                  role="menu"
                  className="absolute left-0 top-12 z-30 w-80 max-w-[calc(100vw-2rem)] rounded-[24px] border border-[#E1E7F0] dark:border-[#333537] bg-white dark:bg-[#1E1F20] p-2 shadow-xl space-y-1"
                >
                  <button
                    type="button"
                    role="menuitemradio"
                    aria-checked={modelChoice === 'standard'}
                    onClick={() => handleSelectModelFromHeader('standard')}
                    className={`flex w-full items-start justify-between gap-3 rounded-2xl px-3.5 py-2.5 text-left transition-colors ${
                      modelChoice === 'standard'
                        ? 'bg-[#E8F0FE] dark:bg-[#004A77]/50'
                        : 'hover:bg-[#F2F3F5] dark:hover:bg-[#282A2C]'
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-[#1F1F1F] dark:text-[#E3E3E3]">
                        Standard High-Level Coding
                      </div>
                      <div className="text-xs text-[#5F6368] dark:text-[#9AA0A6]">
                        Full-stack web, Luau UI libraries &amp; auto-debug loop
                      </div>
                    </div>
                    {modelChoice === 'standard' && (
                      <Check className="mt-0.5 h-4 w-4 shrink-0 text-[#1A73E8] dark:text-[#8AB4F8]" />
                    )}
                  </button>

                  <button
                    type="button"
                    role="menuitemradio"
                    aria-checked={modelChoice === 'hyper'}
                    onClick={() => handleSelectModelFromHeader('hyper')}
                    className={`flex w-full items-start justify-between gap-3 rounded-2xl px-3.5 py-2.5 text-left transition-colors ${
                      modelChoice === 'hyper'
                        ? 'bg-[#E8F0FE] dark:bg-[#004A77]/50'
                        : 'hover:bg-[#F2F3F5] dark:hover:bg-[#282A2C]'
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 text-sm font-medium text-[#1F1F1F] dark:text-[#E3E3E3]">
                        <Cpu className="h-3.5 w-3.5 text-[#1A73E8] dark:text-[#8AB4F8]" />
                        <span>IND HYPER CODING MODEL</span>
                      </div>
                      <div className="text-xs text-[#5F6368] dark:text-[#9AA0A6]">
                        Deep planning, self-review pass &amp; ZIP export · Plus
                      </div>
                    </div>
                    {!isPlus ? (
                      <Lock className="mt-0.5 h-4 w-4 shrink-0 text-[#5F6368]" />
                    ) : modelChoice === 'hyper' ? (
                      <Check className="mt-0.5 h-4 w-4 shrink-0 text-[#1A73E8] dark:text-[#8AB4F8]" />
                    ) : null}
                  </button>
                </div>
              )}
            </div>

            {activeView !== 'command' && (
              <span className="hidden md:inline-flex items-center gap-2 text-sm text-[#5F6368] dark:text-[#9AA0A6]">
                <span aria-hidden="true">/</span>
                <span className="font-medium text-[#1F1F1F] dark:text-[#E3E3E3]">
                  {VIEW_LABELS[activeView]}
                </span>
              </span>
            )}
          </div>

          {/* Right Cluster: Dashed Compose Button + Optional Desktop Sign in + Green Circular Avatar */}
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={handleStartNewChat}
              aria-label="New chat"
              title="Start new chat"
              className="inline-flex h-10 w-10 items-center justify-center rounded-full text-[#1F1F1F] dark:text-[#E3E3E3] hover:bg-[#F2F3F5] dark:hover:bg-[#282A2C] transition-colors"
            >
              <DashedComposeIcon />
            </button>

            {!authUser && (
              <button
                type="button"
                disabled={authBusy}
                onClick={() => void handleSignInGoogle()}
                className="hidden sm:inline-flex h-9 items-center gap-1.5 rounded-full bg-[#1A73E8] px-3.5 text-xs font-medium text-white hover:bg-[#1557B0] disabled:opacity-50 transition-colors whitespace-nowrap shrink-0"
              >
                <LogIn className="h-3.5 w-3.5" aria-hidden="true" />
                <span>{authBusy ? 'Signing in...' : 'Sign in'}</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => setAccountSheetOpen(true)}
              aria-label={`Open account menu for ${profileDisplayName}`}
              title={`${profileDisplayName} · Click for account & plans`}
              className="inline-flex h-10 w-10 items-center justify-center rounded-full hover:ring-4 hover:ring-[#E8F0FE] dark:hover:ring-[#282A2C] transition-all shrink-0"
            >
              {authUser?.photoURL ? (
                <img
                  src={authUser.photoURL}
                  alt={profileDisplayName}
                  referrerPolicy="no-referrer"
                  className="h-9 w-9 rounded-full object-cover"
                />
              ) : (
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[#689F38] text-[15px] font-normal tracking-tight text-white">
                  {profileInitials}
                </span>
              )}
            </button>
          </div>
        </header>

        {authError && (
          <div
            role="alert"
            className="mx-4 sm:mx-6 mb-2 flex items-center justify-between gap-2 rounded-xl border border-[#F5C2C0] bg-[#FCE8E6]/80 dark:bg-[#3B1E1D] px-4 py-2 text-xs text-[#A50E0E] dark:text-[#F6AEA9]"
          >
            <span>{authError}</span>
            <button
              type="button"
              onClick={() => setAuthError(null)}
              aria-label="Dismiss auth error"
              className="rounded-full p-1 hover:bg-black/5"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        <main className="min-h-0 flex-1 overflow-hidden">
          {activeView === 'command' && (
            <div className="flex h-full min-h-0 w-full overflow-hidden">
              <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
                <CommandView
                  sessionId={activeSessionId}
                  messages={messages}
                  mode={mode}
                  onModeChange={setMode}
                  modelChoice={modelChoice}
                  onModelChoiceChange={setModelChoice}
                  showHyperUpgradePrompt={showHyperUpgradePrompt}
                  onDismissHyperUpgradePrompt={() => setShowHyperUpgradePrompt(false)}
                  fastMode={fastMode}
                  onToggleFastMode={() =>
                    setPrefs((p) => ({ ...p, fastMode: !p.fastMode }))
                  }
                  debugLoop={debugLoop}
                  onToggleDebugLoop={() =>
                    setPrefs((p) => ({ ...p, debugLoop: !p.debugLoop }))
                  }
                  showTasks={showTasks}
                  onToggleShowTasks={() =>
                    setPrefs((p) => ({ ...p, showTasks: !p.showTasks }))
                  }
                  memoryEnabled={memoryEnabled}
                  onToggleMemory={() =>
                    setPrefs((p) => ({ ...p, memoryEnabled: !p.memoryEnabled }))
                  }
                  memoryFacts={memoryFacts}
                  onAddMemoryFact={handleAddMemoryFact}
                  onDeleteMemoryFact={handleDeleteMemoryFact}
                  onClearMemoryFacts={handleClearMemoryFacts}
                  skills={allSkills}
                  onOpenSkillsModal={() => setSkillsModalOpen(true)}
                  suppressSlashPalette={skillsModalOpen || settingsModalOpen || accountSheetOpen}
                  customInstructionsActive={customInstructionsActive}
                  onOpenSettingsModal={() => setSettingsModalOpen(true)}
                  contextDrawerOpen={contextDrawerOpen}
                  onCloseContextDrawer={() => setContextDrawerOpen(false)}
                  account={account}
                  draftInput={draftInput}
                  onDraftInputChange={setDraftInput}
                  onSend={(t, atts, opts) => handleSendChat(t, atts, opts)}
                  sending={sending}
                  liveTasks={liveTasks}
                  streamingReply={streamingReply}
                  actions={safeActions}
                  onApproveAction={handleApproveAction}
                  onRejectAction={handleRejectAction}
                  onQueueDraft={handleQueueDraft}
                  onQueueSaveToDrive={handleQueueSaveToDrive}
                  onPreviewHtml={setPreviewHtml}
                  onOpenArtifact={handleOpenArtifact}
                  activeArtifactSourceMessageId={activeArtifact?.sourceMessageId}
                  onNavigateApprovals={() => navigateToView('approvals')}
                  onNavigateTools={() => navigateToView('tools')}
                  onNavigatePlans={() => navigateToView('plans')}
                  onSignInGoogle={handleSignInGoogle}
                  authBusy={authBusy}
                  toolStatus={toolStatus}
                />
              </div>

              {/* Split-Pane Live Artifacts Workbench (Single instance: responsive mobile overlay + desktop split-pane) */}
              {activeArtifact && (
                <div className="fixed inset-0 z-40 flex h-full min-h-0 bg-white dark:bg-[#131314] lg:static lg:z-auto lg:w-[50%] xl:w-[54%] lg:shrink-0">
                  <ArtifactWorkbench
                    artifact={activeArtifact}
                    sending={sending}
                    onUpdateFiles={(nextFiles, nextPath) =>
                      setActiveArtifact((prev) =>
                        prev ? { ...prev, files: nextFiles, activePath: nextPath } : null
                      )
                    }
                    onSelectVersion={handleSelectArtifactVersion}
                    onPreviewFullscreen={setPreviewHtml}
                    onClose={() => setActiveArtifact(null)}
                    onQueueSaveToDrive={(file) => void handleQueueSaveToDrive(file)}
                    onRefineWithAi={handleRefineArtifactWithAi}
                  />
                </div>
              )}
            </div>
          )}

          {activeView === 'approvals' && (
            <ApprovalsView
              actions={safeActions}
              onApprove={handleApproveAction}
              onReject={handleRejectAction}
              onQueueDraft={handleQueueDraft}
              onGoToCommand={() => navigateToView('command')}
            />
          )}

          {activeView === 'tools' && (
            <ToolsView
              toolStatus={toolStatus}
              onRefreshStatus={refreshStatus}
              onConnectGmail={handleConnectGmail}
              onDisconnectGmail={handleDisconnectGmail}
              onConnectDrive={handleConnectDrive}
              onDisconnectDrive={handleDisconnectDrive}
              gmailBusy={gmailBusy}
              gmailError={gmailError}
              driveBusy={driveBusy}
              driveError={driveError}
              onSendPromptToAgent={handleSendPromptToAgent}
              onQueueSaveToDrive={handleQueueSaveToDrive}
              onQueueDriveUpdate={handleQueueDriveUpdate}
              onQueueDriveDelete={handleQueueDriveDelete}
            />
          )}

          {activeView === 'business' && (
            <BusinessView
              tasks={safeTasks}
              onAddTask={handleAddTask}
              onCycleTaskStatus={handleCycleTaskStatus}
              onRemoveTask={handleRemoveTask}
              onSendToAgent={(prompt) => handleSendPromptToAgent(prompt, 'business')}
            />
          )}

          {activeView === 'plans' && (
            <PlansView
              account={account}
              authUser={authUser}
              isOwner={isOwner}
              billingSettings={effectiveBillingSettings}
              userPaymentRequests={userPaymentRequests}
              allPaymentRequests={allPaymentRequests}
              onGoToCommand={() => navigateToView('command')}
              onSignInGoogle={handleSignInGoogle}
              onSubmitPayment={async ({ utr, payerUpi }) => {
                if (!authUser) {
                  throw new Error('Sign in with Google before submitting a UPI payment.');
                }
                await submitPaymentRequest({
                  uid: authUser.uid,
                  email: authUser.email,
                  displayName: authUser.displayName,
                  utr,
                  payerUpi,
                });
              }}
              onSaveBillingSettings={async (upiId, payeeName) => {
                await saveBillingSettings(upiId, payeeName);
              }}
              onReviewPayment={async (request, decision, adminNote) => {
                const { planExpiresAt } = await reviewPaymentRequestAndActivatePlan({
                  request,
                  decision,
                  adminNote,
                });
                if (decision === 'approved' && auth.currentUser) {
                  try {
                    const idToken = await auth.currentUser.getIdToken();
                    const updated = await adminSetUserPlanOnServer(
                      idToken,
                      request.userId,
                      'plus',
                      planExpiresAt
                    );
                    if (authUser && request.userId === authUser.uid) {
                      setAccount(updated);
                    }
                  } catch {
                    // Firestore is already updated; user's next session sync adopts Plus automatically
                  }
                }
              }}
              onToggleOwnerPlan={async (nextPlan) => {
                if (!authUser || !auth.currentUser) return;
                await setOwnerTestingPlan(authUser.uid, nextPlan);
                try {
                  const idToken = await auth.currentUser.getIdToken();
                  const updated = await adminSetUserPlanOnServer(idToken, authUser.uid, nextPlan);
                  setAccount(updated);
                  if (nextPlan === 'plus') {
                    setModelChoice('hyper');
                  } else {
                    setModelChoice('standard');
                  }
                } catch {
                  // Firestore snapshot listener updates UI automatically
                }
              }}
              authBusy={authBusy}
            />
          )}
        </main>
      </div>

      <HtmlPreviewModal html={previewHtml} onClose={() => setPreviewHtml(null)} />

      <SkillsModal
        open={skillsModalOpen}
        skills={allSkills}
        isCloudSynced={Boolean(authUser)}
        onClose={() => setSkillsModalOpen(false)}
        onUseSkill={handleUseSkill}
        onSaveCustomSkill={handleSaveCustomSkill}
        onDeleteCustomSkill={handleDeleteCustomSkill}
      />

      <SettingsModal
        open={settingsModalOpen}
        onClose={() => setSettingsModalOpen(false)}
        customInstructions={customInstructions}
        onSaveCustomInstructions={handleSaveCustomInstructions}
        theme={theme}
        onThemeChange={setTheme}
        prefs={prefs}
        onTogglePref={(key) => setPrefs((p) => ({ ...p, [key]: !p[key] }))}
        authUser={authUser}
        authBusy={authBusy}
        onSignInGoogle={handleSignInGoogle}
        onSignOutGoogle={handleSignOutGoogle}
        sessionCount={sessions.length}
        memoryCount={memoryFacts.length}
        onClearAllChats={handleClearAllChats}
        onClearMemoryFacts={handleClearMemoryFacts}
      />

      <AccountSheetModal
        open={accountSheetOpen}
        onClose={() => setAccountSheetOpen(false)}
        authUser={authUser}
        authBusy={authBusy}
        account={account}
        theme={theme}
        onToggleTheme={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
        onSignInGoogle={handleSignInGoogle}
        onSignOutGoogle={handleSignOutGoogle}
        onOpenPlans={() => navigateToView('plans')}
        onOpenSettings={() => setSettingsModalOpen(true)}
        onOpenSkills={() => setSkillsModalOpen(true)}
        customInstructionsActive={customInstructionsActive}
        skillCount={allSkills.length}
      />
    </div>
  );
}
