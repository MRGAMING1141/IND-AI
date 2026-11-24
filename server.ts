import 'dotenv/config';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import {
  GeminiRateLimitError,
  approveAndExecuteActionForUser,
  createPendingActionForUser,
  listActionsForUser,
  rejectPendingActionForUser,
  runAgentChatTurn,
} from './server/agentService.ts';
import {
  IND_AGENT_DRIVE_FOLDER,
  listDriveFiles,
  readDriveFile,
  readGmailMessage,
  searchGmailMessages,
} from './server/toolConnectors.ts';
import { tokenVault } from './server/tokenVault.ts';
import { userStore } from './server/userStore.ts';
import { memoryStore } from './server/memoryStore.ts';
import { chatJobStore } from './server/chatJobStore.ts';
import { normalizeFocus, runPromptOptimization } from './server/promptOptimizer.ts';
import { isForbiddenDeleteAction, redactSecrets } from './src/utils/safetyEngine.ts';
import { PLAN_SPECS } from './src/utils/planEngine.ts';
import {
  PLUS_PRICE_INR,
  isAdminEmail,
  isPlusSubscriptionActive,
  isValidUpiId,
  normalizeUpiId,
} from './src/utils/paymentEngine.ts';
import type {
  ActionType,
  AgentMode,
  ChatAttachment,
  MemoryFact,
  ModelChoice,
  UserPlan,
} from './src/types/agent.ts';

const PORT = Number(process.env.PORT) || 3000;
const SESSION_COOKIE = 'ind_uid';

interface FirebaseAppletConfig {
  apiKey: string;
  projectId: string;
  firestoreDatabaseId: string;
}

let cachedFirebaseConfig: FirebaseAppletConfig | null = null;
function getFirebaseConfig(): FirebaseAppletConfig | null {
  if (cachedFirebaseConfig) return cachedFirebaseConfig;
  try {
    const configPath = path.resolve(process.cwd(), 'firebase-applet-config.json');
    const raw = fs.readFileSync(configPath, 'utf8');
    const parsed = JSON.parse(raw) as {
      apiKey?: unknown;
      projectId?: unknown;
      firestoreDatabaseId?: unknown;
    };
    const apiKey = typeof parsed.apiKey === 'string' ? parsed.apiKey.trim() : '';
    const projectId = typeof parsed.projectId === 'string' ? parsed.projectId.trim() : '';
    const firestoreDatabaseId =
      typeof parsed.firestoreDatabaseId === 'string' && parsed.firestoreDatabaseId.trim()
        ? parsed.firestoreDatabaseId.trim()
        : '(default)';
    if (!apiKey || !projectId) return null;
    cachedFirebaseConfig = { apiKey, projectId, firestoreDatabaseId };
    return cachedFirebaseConfig;
  } catch {
    return null;
  }
}

// Stable across server restarts so signed Firebase cookies do not drop on cold start
const SESSION_SIGNING_SECRET = (() => {
  const seed =
    process.env.SESSION_SECRET ||
    process.env.TOKEN_ENCRYPTION_KEY ||
    process.env.GEMINI_API_KEY ||
    getFirebaseConfig()?.projectId ||
    crypto.randomBytes(32).toString('hex');
  return crypto.createHash('sha256').update(`ind-agent-session:${seed}`).digest('hex');
})();

interface VerifiedFbUser {
  localId: string;
  email?: string;
  displayName?: string;
  emailVerified: boolean;
}

const verifiedTokenCache = new Map<string, { user: VerifiedFbUser; expiresAt: number }>();
const hydratedUids = new Set<string>();

async function verifyFirebaseIdToken(idToken: string): Promise<VerifiedFbUser | null> {
  const cfg = getFirebaseConfig();
  if (!cfg) return null;

  const tokenKey = crypto.createHash('sha256').update(idToken).digest('hex');
  const cached = verifiedTokenCache.get(tokenKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.user;
  }

  const lookupRes = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(cfg.apiKey)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken }),
    }
  );
  if (!lookupRes.ok) return null;
  const data = (await lookupRes.json()) as {
    users?: Array<{
      localId?: string;
      email?: string;
      displayName?: string;
      emailVerified?: boolean;
    }>;
  };
  const fbUser = data?.users?.[0];
  if (!fbUser?.localId || !/^[a-zA-Z0-9_-]{6,128}$/.test(fbUser.localId)) {
    return null;
  }
  const verified: VerifiedFbUser = {
    localId: fbUser.localId,
    email: typeof fbUser.email === 'string' ? fbUser.email : undefined,
    displayName: typeof fbUser.displayName === 'string' ? fbUser.displayName : undefined,
    emailVerified: fbUser.emailVerified === true,
  };
  if (verifiedTokenCache.size > 200) {
    verifiedTokenCache.clear();
  }
  verifiedTokenCache.set(tokenKey, { user: verified, expiresAt: Date.now() + 120_000 });
  return verified;
}

/**
 * Authoritatively reads `/users/{uid}` directly from Firestore REST API using the user's own
 * verified Firebase ID token. Because `firestore.rules` blocks users from modifying `plan` or
 * `planExpiresAt`, this gives the server tamper-proof plan & usage state even after restarts.
 */
async function fetchAuthoritativeFirestoreProfile(
  uid: string,
  idToken: string
): Promise<{
  plan: UserPlan;
  planExpiresAt?: number;
  usageWindowStart?: number;
  usageWindowCount?: number;
} | null> {
  const cfg = getFirebaseConfig();
  if (!cfg) return null;
  try {
    const url = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(cfg.projectId)}/databases/${encodeURIComponent(cfg.firestoreDatabaseId)}/documents/users/${encodeURIComponent(uid)}`;
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${idToken}`,
      },
    });
    if (!res.ok) return null;
    const doc = (await res.json()) as {
      fields?: Record<string, { stringValue?: string; integerValue?: string }>;
    };
    const fields = doc?.fields;
    if (!fields) return null;

    const rawPlan: UserPlan = fields.plan?.stringValue === 'plus' ? 'plus' : 'free';
    const rawExpires = Number(fields.planExpiresAt?.integerValue ?? '0');
    const planExpiresAt = Number.isFinite(rawExpires) && rawExpires > 0 ? Math.floor(rawExpires) : undefined;
    const effectivePlan: UserPlan = isPlusSubscriptionActive(rawPlan, planExpiresAt) ? 'plus' : 'free';

    const rawStart = Number(fields.usageWindowStart?.integerValue ?? '0');
    const rawCount = Number(fields.usageWindowCount?.integerValue ?? '0');
    return {
      plan: effectivePlan,
      planExpiresAt: effectivePlan === 'plus' ? planExpiresAt : undefined,
      usageWindowStart: Number.isFinite(rawStart) && rawStart > 0 ? Math.floor(rawStart) : undefined,
      usageWindowCount: Number.isFinite(rawCount) && rawCount > 0 ? Math.floor(rawCount) : undefined,
    };
  } catch {
    return null;
  }
}

function signFirebaseUserId(userId: string): string {
  const sig = crypto
    .createHmac('sha256', SESSION_SIGNING_SECRET)
    .update(userId)
    .digest('hex')
    .slice(0, 32);
  return `${userId}.${sig}`;
}

function verifySignedFirebaseCookie(raw: string): string | null {
  const dotIdx = raw.lastIndexOf('.');
  if (dotIdx <= 0) return null;
  const userId = raw.slice(0, dotIdx);
  const sig = raw.slice(dotIdx + 1);
  if (!/^fb_[a-zA-Z0-9_-]{6,128}$/.test(userId) || !/^[a-f0-9]{32}$/.test(sig)) {
    return null;
  }
  const expected = crypto
    .createHmac('sha256', SESSION_SIGNING_SECRET)
    .update(userId)
    .digest('hex')
    .slice(0, 32);
  const a = Buffer.from(sig, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return null;
  }
  return userId;
}

const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '15mb' }));

// Verify same-origin or custom X-Requested-With header on mutating API routes
app.use('/api', (req, res, next) => {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
    next();
    return;
  }
  const xrw = req.headers['x-requested-with'];
  if (xrw === 'ind-agent') {
    next();
    return;
  }
  const origin = req.headers.origin;
  const host = (req.headers['x-forwarded-host'] as string | undefined) ?? req.headers.host;
  if (origin && host) {
    try {
      const originHost = new URL(origin).host;
      if (originHost === host.split(',')[0].trim()) {
        next();
        return;
      }
    } catch {
      // Invalid origin URL
    }
  }
  res.status(403).json({ error: 'Forbidden cross-origin request.', code: 'FORBIDDEN' });
});

function parseCookies(cookieHeader: string | undefined): Record<string, string> {
  const result: Record<string, string> = {};
  if (!cookieHeader) return result;
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    if (key) {
      try {
        result[key] = decodeURIComponent(val);
      } catch {
        result[key] = val;
      }
    }
  }
  return result;
}

function setSessionCookie(res: express.Response, cookieValue: string): void {
  res.setHeader(
    'Set-Cookie',
    `${SESSION_COOKIE}=${encodeURIComponent(cookieValue)}; Path=/; HttpOnly; Secure; SameSite=None; Partitioned; Max-Age=604800`
  );
}

/**
 * Supports both temporary guest HttpOnly IDs and HMAC-signed Firebase authenticated user IDs.
 */
function ensureUserId(req: express.Request, res: express.Response): string {
  const cookies = parseCookies(req.headers.cookie);
  const existing = cookies[SESSION_COOKIE];
  if (existing) {
    const verifiedFb = verifySignedFirebaseCookie(existing);
    if (verifiedFb) {
      userStore.getOrCreateUser(verifiedFb);
      return verifiedFb;
    }
    if (/^[a-f0-9]{48}$/.test(existing)) {
      userStore.getOrCreateUser(existing);
      return existing;
    }
  }
  const created = crypto.randomBytes(24).toString('hex');
  setSessionCookie(res, created);
  userStore.getOrCreateUser(created);
  return created;
}

/**
 * Resolves the authenticated user via Authorization Bearer Firebase ID token (immune to iframe
 * third-party cookie blocking and server cold starts), falling back to the HttpOnly cookie.
 */
async function resolveRequestUserId(
  req: express.Request,
  res: express.Response
): Promise<string> {
  const authHeader = req.headers.authorization;
  if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
    const idToken = authHeader.slice(7).trim();
    if (idToken.length > 20 && idToken.length <= 8192) {
      try {
        const fbUser = await verifyFirebaseIdToken(idToken);
        if (fbUser && fbUser.emailVerified) {
          const userId = `fb_${fbUser.localId}`;
          setSessionCookie(res, signFirebaseUserId(userId));
          userStore.updateIdentity(userId, {
            email: fbUser.email,
            displayName: fbUser.displayName,
            authType: 'google',
          });
          if (!hydratedUids.has(userId)) {
            hydratedUids.add(userId);
            const firestoreProfile = await fetchAuthoritativeFirestoreProfile(
              fbUser.localId,
              idToken
            );
            if (firestoreProfile) {
              userStore.setUserPlanInternal(
                userId,
                firestoreProfile.plan,
                firestoreProfile.planExpiresAt
              );
              if (firestoreProfile.usageWindowStart && firestoreProfile.usageWindowCount) {
                userStore.hydrateUsageFromCloud(userId, {
                  windowStartedAtMs: firestoreProfile.usageWindowStart,
                  windowMessagesUsed: firestoreProfile.usageWindowCount,
                });
              }
            } else if (isAdminEmail(fbUser.email)) {
              userStore.setUserPlanInternal(userId, 'plus');
            }
          }
          return userId;
        }
      } catch {
        // Fall through to cookie resolution
      }
    }
  }
  return ensureUserId(req, res);
}

// ---------------- PRODUCTION HEALTH CHECK ----------------

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    status: 'healthy',
    uptimeSec: Math.round(process.uptime()),
  });
});

// ---------------- ACCOUNT & PLANS (PHASE 1 GUEST + PHASE 2 GOOGLE AUTH) ----------------

app.get('/api/account', async (req, res) => {
  const userId = await resolveRequestUserId(req, res);
  res.json({
    account: userStore.getAccountSummary(userId),
    plans: PLAN_SPECS,
  });
});

function parseCloudUsageInput(raw: unknown): {
  windowStartedAtMs?: number;
  windowMessagesUsed?: number;
} | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const obj = raw as Record<string, unknown>;
  const windowStartedAtMs =
    typeof obj.windowStartedAtMs === 'number' &&
    Number.isFinite(obj.windowStartedAtMs) &&
    obj.windowStartedAtMs >= 0
      ? Math.floor(obj.windowStartedAtMs)
      : undefined;
  const windowMessagesUsed =
    typeof obj.windowMessagesUsed === 'number' &&
    Number.isFinite(obj.windowMessagesUsed) &&
    obj.windowMessagesUsed >= 0
      ? Math.min(10_000, Math.floor(obj.windowMessagesUsed))
      : undefined;
  if (windowStartedAtMs === undefined && windowMessagesUsed === undefined) return undefined;
  return { windowStartedAtMs, windowMessagesUsed };
}

app.post('/api/account/hydrate-usage', async (req, res) => {
  const userId = await resolveRequestUserId(req, res);
  if (!userId.startsWith('fb_')) {
    res.status(401).json({ error: 'Signed-in Firebase session required.', code: 'UNAUTHORIZED' });
    return;
  }
  const cloudUsage = parseCloudUsageInput(req.body);
  const account = userStore.hydrateUsageFromCloud(userId, cloudUsage);
  res.json({ account });
});

app.get('/api/billing/defaults', (_req, res) => {
  const rawUpi = typeof process.env.FAMPAY_UPI_ID === 'string' ? process.env.FAMPAY_UPI_ID.trim() : '';
  const upiId = isValidUpiId(rawUpi) ? normalizeUpiId(rawUpi) : '';
  const rawPayee =
    typeof process.env.FAMPAY_PAYEE_NAME === 'string' ? process.env.FAMPAY_PAYEE_NAME.trim() : '';
  res.json({
    upiId,
    payeeName: rawPayee.slice(0, 60) || 'IND AGENT',
    priceInr: PLUS_PRICE_INR,
  });
});

app.post('/api/admin/set-user-plan', async (req, res) => {
  const body = (req.body ?? {}) as {
    idToken?: unknown;
    targetUid?: unknown;
    plan?: unknown;
    planExpiresAt?: unknown;
  };
  const idToken = typeof body.idToken === 'string' ? body.idToken.trim() : '';
  const targetUid = typeof body.targetUid === 'string' ? body.targetUid.trim() : '';
  const plan: UserPlan = body.plan === 'plus' ? 'plus' : 'free';
  const planExpiresAt =
    typeof body.planExpiresAt === 'number' && Number.isFinite(body.planExpiresAt) && body.planExpiresAt > 0
      ? Math.floor(body.planExpiresAt)
      : undefined;

  if (!idToken || idToken.length > 8192) {
    res.status(401).json({ error: 'Admin Firebase ID token is required.', code: 'UNAUTHORIZED' });
    return;
  }
  if (!/^[a-zA-Z0-9_-]{6,128}$/.test(targetUid)) {
    res.status(400).json({ error: 'Valid target user ID is required.', code: 'INVALID_USER' });
    return;
  }

  try {
    const caller = await verifyFirebaseIdToken(idToken);
    if (!caller || !caller.emailVerified || !isAdminEmail(caller.email)) {
      res.status(403).json({ error: 'Only the app owner can activate Plus plans.', code: 'FORBIDDEN' });
      return;
    }

    const targetUserId = `fb_${targetUid}`;
    userStore.setUserPlanInternal(targetUserId, plan, plan === 'plus' ? planExpiresAt : undefined);
    res.json({
      ok: true,
      account: userStore.getAccountSummary(targetUserId),
    });
  } catch {
    res.status(502).json({ error: 'Could not verify owner session with Firebase.', code: 'UPSTREAM_ERROR' });
  }
});

app.post('/api/auth/firebase/session', async (req, res) => {
  const body = (req.body ?? {}) as { idToken?: unknown; cloudUsage?: unknown };
  const idToken = typeof body.idToken === 'string' ? body.idToken.trim() : '';
  if (!idToken || idToken.length > 8192) {
    res.status(400).json({ error: 'Valid Firebase ID token is required.', code: 'INVALID_TOKEN' });
    return;
  }

  const cfg = getFirebaseConfig();
  if (!cfg) {
    res.status(500).json({ error: 'Firebase web configuration is missing on server.', code: 'CONFIG_ERROR' });
    return;
  }

  try {
    const fbUser = await verifyFirebaseIdToken(idToken);
    if (!fbUser) {
      res.status(401).json({ error: 'Firebase session verification failed.', code: 'INVALID_TOKEN' });
      return;
    }
    if (!fbUser.emailVerified) {
      res.status(403).json({
        error: 'Please use a verified Google account email to sign in.',
        code: 'EMAIL_UNVERIFIED',
      });
      return;
    }

    const userId = `fb_${fbUser.localId}`;
    setSessionCookie(res, signFirebaseUserId(userId));
    userStore.updateIdentity(userId, {
      email: fbUser.email,
      displayName: fbUser.displayName,
      authType: 'google',
    });

    // Authoritatively sync plan, expiry, and usage directly from Firestore using the user's verified token
    hydratedUids.add(userId);
    const firestoreProfile = await fetchAuthoritativeFirestoreProfile(fbUser.localId, idToken);
    if (firestoreProfile) {
      userStore.setUserPlanInternal(userId, firestoreProfile.plan, firestoreProfile.planExpiresAt);
      if (firestoreProfile.usageWindowStart && firestoreProfile.usageWindowCount) {
        userStore.hydrateUsageFromCloud(userId, {
          windowStartedAtMs: firestoreProfile.usageWindowStart,
          windowMessagesUsed: firestoreProfile.usageWindowCount,
        });
      }
    } else if (isAdminEmail(fbUser.email)) {
      userStore.setUserPlanInternal(userId, 'plus');
    }

    const cloudUsage = parseCloudUsageInput(body.cloudUsage);
    const account = cloudUsage
      ? userStore.hydrateUsageFromCloud(userId, cloudUsage)
      : userStore.getAccountSummary(userId);

    res.json({ account });
  } catch {
    res.status(502).json({ error: 'Could not verify Google account with Firebase.', code: 'UPSTREAM_ERROR' });
  }
});

app.post('/api/auth/firebase/logout', (_req, res) => {
  const freshGuest = crypto.randomBytes(24).toString('hex');
  setSessionCookie(res, freshGuest);
  userStore.getOrCreateUser(freshGuest);
  res.json({
    account: userStore.getAccountSummary(freshGuest),
  });
});

// ---------------- PER-USER CHAT MEMORY ----------------

app.get('/api/memory', (req, res) => {
  const userId = ensureUserId(req, res);
  res.json({ facts: memoryStore.listFacts(userId) });
});

app.post('/api/memory', (req, res) => {
  const userId = ensureUserId(req, res);
  const body = (req.body ?? {}) as { content?: unknown; category?: unknown };
  const content = typeof body.content === 'string' ? body.content.trim() : '';
  if (!content) {
    res.status(400).json({ error: 'Memory fact content is required.' });
    return;
  }
  const rawCat = typeof body.category === 'string' ? body.category.toLowerCase() : 'context';
  const category: MemoryFact['category'] =
    rawCat === 'preference' || rawCat === 'project' ? rawCat : 'context';

  try {
    const fact = memoryStore.addFact(userId, redactSecrets(content), category);
    res.status(201).json({ fact, facts: memoryStore.listFacts(userId) });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Could not save memory.' });
  }
});

app.delete('/api/memory/:id', (req, res) => {
  const userId = ensureUserId(req, res);
  memoryStore.deleteFact(userId, req.params.id);
  res.json({ ok: true, facts: memoryStore.listFacts(userId) });
});

app.delete('/api/memory', (req, res) => {
  const userId = ensureUserId(req, res);
  memoryStore.clearFacts(userId);
  res.json({ ok: true, facts: [] });
});

// ---------------- TOOL STATUS ----------------

app.get('/api/tools/status', (req, res) => {
  const userId = ensureUserId(req, res);
  const gmailRec = tokenVault.getToken(userId, 'gmail');
  const driveRec = tokenVault.getToken(userId, 'drive');

  res.json({
    gmail: {
      connected: Boolean(gmailRec?.accessToken),
      accountLabel: gmailRec?.accountLabel,
    },
    drive: {
      connected: Boolean(driveRec?.accessToken),
      accountLabel: driveRec?.accountLabel,
      folderName: IND_AGENT_DRIVE_FOLDER,
    },
  });
});

// ---------------- GMAIL SERVER-ENCRYPTED SESSION ----------------

app.post('/api/auth/gmail/session', (req, res) => {
  const userId = ensureUserId(req, res);
  const body = (req.body ?? {}) as { accessToken?: unknown; email?: unknown; displayName?: unknown };
  const accessToken = typeof body.accessToken === 'string' ? body.accessToken.trim() : '';
  const email = typeof body.email === 'string' ? body.email.trim() : undefined;
  const displayName = typeof body.displayName === 'string' ? body.displayName.trim() : undefined;

  if (!accessToken) {
    res.status(400).json({ error: 'Missing Google OAuth access token for Gmail.' });
    return;
  }

  tokenVault.setToken(userId, 'gmail', {
    accessToken,
    accountLabel: email || 'Google account',
    connectedAt: new Date().toISOString(),
  });
  userStore.updateIdentity(userId, { email, displayName });

  res.json({ connected: true, accountLabel: email || 'Google account' });
});

app.post('/api/auth/gmail/disconnect', (req, res) => {
  const userId = ensureUserId(req, res);
  tokenVault.deleteToken(userId, 'gmail');
  res.json({ ok: true });
});

// ---------------- GOOGLE DRIVE SERVER-ENCRYPTED SESSION (drive.file) ----------------

app.post('/api/auth/drive/session', (req, res) => {
  const userId = ensureUserId(req, res);
  const body = (req.body ?? {}) as { accessToken?: unknown; email?: unknown; displayName?: unknown };
  const accessToken = typeof body.accessToken === 'string' ? body.accessToken.trim() : '';
  const email = typeof body.email === 'string' ? body.email.trim() : undefined;
  const displayName = typeof body.displayName === 'string' ? body.displayName.trim() : undefined;

  if (!accessToken) {
    res.status(400).json({ error: 'Missing Google OAuth access token for Google Drive.' });
    return;
  }

  tokenVault.setToken(userId, 'drive', {
    accessToken,
    accountLabel: email || 'Google account',
    connectedAt: new Date().toISOString(),
  });
  userStore.updateIdentity(userId, { email, displayName });

  res.json({
    connected: true,
    accountLabel: email || 'Google account',
    folderName: IND_AGENT_DRIVE_FOLDER,
  });
});

app.post('/api/auth/drive/disconnect', (req, res) => {
  const userId = ensureUserId(req, res);
  tokenVault.deleteToken(userId, 'drive');
  res.json({ ok: true });
});

// ---------------- IND AGENT CHAT (JSON & STREAMING NDJSON) ----------------

function parseChatBody(body: Record<string, unknown>) {
  const message = typeof body.message === 'string' ? body.message.trim() : '';
  const attachments = Array.isArray(body.attachments)
    ? (body.attachments as ChatAttachment[]).slice(0, 4)
    : [];
  const mode: AgentMode =
    body.mode === 'coding' || body.mode === 'business' ? body.mode : 'auto';
  const modelChoice: ModelChoice = body.modelChoice === 'hyper' ? 'hyper' : 'standard';
  const fastMode = body.fastMode !== false;
  const debugLoop = body.debugLoop !== false;
  const memoryEnabled = body.memoryEnabled !== false;
  const customInstructions =
    typeof body.customInstructions === 'string'
      ? body.customInstructions.trim().slice(0, 1500)
      : '';
  const skipAutoCodeVerify = body.skipAutoCodeVerify === true;
  const rawHistory = Array.isArray(body.history) ? body.history : [];
  const history = rawHistory.filter(
    (item): item is { role: 'user' | 'assistant'; content: string } =>
      Boolean(item) &&
      (item.role === 'user' || item.role === 'assistant') &&
      typeof item.content === 'string'
  );
  return {
    message,
    attachments,
    mode,
    modelChoice,
    fastMode,
    debugLoop,
    memoryEnabled,
    customInstructions,
    skipAutoCodeVerify,
    history,
  };
}

app.post('/api/agent/optimize-prompt', async (req, res) => {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const rawMessage = typeof body.message === 'string' ? body.message.trim() : '';
    if (!rawMessage) {
      res.status(400).json({
        error: 'Type a draft prompt first so the optimizer can analyze it.',
        code: 'EMPTY_PROMPT',
      });
      return;
    }
    if (rawMessage.length > 6000) {
      res.status(400).json({
        error: 'Prompt is too long to optimize (maximum 6,000 characters).',
        code: 'PROMPT_TOO_LONG',
      });
      return;
    }

    const mode: AgentMode =
      body.mode === 'coding' || body.mode === 'business' ? body.mode : 'auto';
    const focus = normalizeFocus(body.focus);

    const rawHistory = Array.isArray(body.history) ? body.history : [];
    const history = rawHistory
      .filter(
        (item): item is { role: 'user' | 'assistant'; content: string } =>
          Boolean(item) &&
          typeof item === 'object' &&
          ((item as { role?: unknown }).role === 'user' ||
            (item as { role?: unknown }).role === 'assistant') &&
          typeof (item as { content?: unknown }).content === 'string'
      )
      .slice(-4)
      .map((item) => ({
        role: item.role,
        content: item.content.slice(0, 8000),
      }));

    const result = await runPromptOptimization({
      message: rawMessage,
      mode,
      focus,
      history,
    });

    res.json(result);
  } catch (err) {
    const safeMsg = redactSecrets(
      err instanceof Error ? err.message : 'Prompt optimization failed.'
    );
    res.status(502).json({
      error: safeMsg,
      code: 'OPTIMIZER_ERROR',
    });
  }
});

app.post('/api/agent/chat', async (req, res) => {
  const userId = await resolveRequestUserId(req, res);
  try {
    const parsed = parseChatBody((req.body ?? {}) as Record<string, unknown>);
    if (!parsed.message && parsed.attachments.length === 0) {
      res
        .status(400)
        .json({ error: 'Enter a message or attach a file/image.', code: 'EMPTY_MESSAGE' });
      return;
    }

    const allowance = userStore.checkMessageAllowance(userId, parsed.modelChoice);
    if (!allowance.allowed) {
      res.status(allowance.status).json({
        error: allowance.error,
        code: allowance.code,
      });
      return;
    }

    const gmailRec = tokenVault.getToken(userId, 'gmail');
    const driveRec = tokenVault.getToken(userId, 'drive');

    const result = await runAgentChatTurn({
      userId,
      history: parsed.history,
      message: parsed.message,
      mode: parsed.mode,
      plan: allowance.record.plan,
      modelChoice: parsed.modelChoice,
      fastMode: parsed.fastMode,
      debugLoop: parsed.debugLoop,
      memoryEnabled: parsed.memoryEnabled,
      customInstructions: parsed.customInstructions,
      skipAutoCodeVerify: parsed.skipAutoCodeVerify,
      attachments: parsed.attachments,
      creds: {
        gmailToken: gmailRec?.accessToken,
        driveToken: driveRec?.accessToken,
      },
    });

    const updatedAccount = userStore.recordMessageUsage(userId);

    res.json({
      reply: result.reply ?? '',
      createdActions: Array.isArray(result.createdActions) ? result.createdActions : [],
      toolsUsed: Array.isArray(result.toolsUsed) ? result.toolsUsed : [],
      injectionAlerts: Array.isArray(result.injectionAlerts) ? result.injectionAlerts : [],
      tasks: Array.isArray(result.tasks) ? result.tasks : [],
      savedMemories: Array.isArray(result.savedMemories) ? result.savedMemories : [],
      modelChoice: result.modelChoice,
      modelLabel: result.modelLabel,
      fastMode: result.fastMode,
      selfReviewApplied: result.selfReviewApplied,
      codeVerification: result.codeVerification,
      webSources: result.webSources,
      searchQueries: result.searchQueries,
      elapsedMs: result.elapsedMs,
      usage: updatedAccount.usage,
    });
  } catch (err) {
    const rawMsg = err instanceof Error ? err.message : 'Agent request failed.';
    const safeMsg = redactSecrets(rawMsg);
    const isConfig = safeMsg.includes('API_KEY') || safeMsg.includes('GEMINI_API_KEY');
    const isRateLimit = err instanceof GeminiRateLimitError || /429|rate limit|quota/i.test(safeMsg);
    const status = isConfig ? 500 : isRateLimit ? 429 : 502;
    res.status(status).json({
      error: safeMsg,
      code: isConfig ? 'CONFIG_ERROR' : isRateLimit ? 'RATE_LIMITED' : 'UPSTREAM_ERROR',
      ...(err instanceof GeminiRateLimitError
        ? { retryAfterSec: err.retryAfterSec, attemptsMade: err.attemptsMade }
        : isRateLimit
          ? { retryAfterSec: 20 }
          : {}),
    });
  }
});

app.post('/api/agent/chat/stream', async (req, res) => {
  const userId = await resolveRequestUserId(req, res);
  const parsed = parseChatBody((req.body ?? {}) as Record<string, unknown>);

  if (!parsed.message && parsed.attachments.length === 0) {
    res
      .status(400)
      .json({ error: 'Enter a message or attach a file/image.', code: 'EMPTY_MESSAGE' });
    return;
  }

  const allowance = userStore.checkMessageAllowance(userId, parsed.modelChoice);
  if (!allowance.allowed) {
    res.status(allowance.status).json({
      error: allowance.error,
      code: allowance.code,
    });
    return;
  }

  // Disable Node socket timeouts for long-running IND HYPER reasoning streams
  req.setTimeout(0);
  res.setTimeout(0);

  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  const job = chatJobStore.createJob(userId);
  let clientDisconnected = false;

  const writeFrame = (payload: Record<string, unknown>) => {
    if (clientDisconnected || res.writableEnded || res.destroyed) return;
    try {
      res.write(`${JSON.stringify(payload)}\n`);
    } catch {
      clientDisconnected = true;
    }
  };

  // Emit jobId + jobToken immediately so client can seamlessly resume via /api/agent/chat/jobs/:jobId
  // if any reverse proxy or mobile browser drops the long-lived HTTP stream early
  writeFrame({ type: 'job', jobId: job.id, jobToken: job.token });

  // Send keepalive ping every 4 seconds to prevent reverse proxy idle read timeouts
  const heartbeat = setInterval(() => {
    if (clientDisconnected || res.writableEnded || res.destroyed) {
      clearInterval(heartbeat);
      return;
    }
    writeFrame({ type: 'ping', ts: Date.now() });
  }, 4_000);

  res.on('close', () => {
    clientDisconnected = true;
    clearInterval(heartbeat);
  });

  try {
    const gmailRec = tokenVault.getToken(userId, 'gmail');
    const driveRec = tokenVault.getToken(userId, 'drive');

    const result = await runAgentChatTurn({
      userId,
      history: parsed.history,
      message: parsed.message,
      mode: parsed.mode,
      plan: allowance.record.plan,
      modelChoice: parsed.modelChoice,
      fastMode: parsed.fastMode,
      debugLoop: parsed.debugLoop,
      memoryEnabled: parsed.memoryEnabled,
      customInstructions: parsed.customInstructions,
      skipAutoCodeVerify: parsed.skipAutoCodeVerify,
      attachments: parsed.attachments,
      creds: {
        gmailToken: gmailRec?.accessToken,
        driveToken: driveRec?.accessToken,
      },
      onEvent: (event) => {
        if (event.type === 'task') {
          chatJobStore.upsertTask(job.id, event.task);
        } else if (event.type === 'delta') {
          chatJobStore.appendDelta(job.id, event.text);
        } else if (event.type === 'replace') {
          chatJobStore.replaceText(job.id, event.text);
        } else if (event.type === 'memory') {
          chatJobStore.addMemory(job.id, event.fact);
        }
        writeFrame(event as unknown as Record<string, unknown>);
      },
    });

    const updatedAccount = userStore.recordMessageUsage(userId);

    const finalPayload: Record<string, unknown> = {
      reply: result.reply ?? '',
      createdActions: Array.isArray(result.createdActions) ? result.createdActions : [],
      toolsUsed: Array.isArray(result.toolsUsed) ? result.toolsUsed : [],
      injectionAlerts: Array.isArray(result.injectionAlerts) ? result.injectionAlerts : [],
      tasks: Array.isArray(result.tasks) ? result.tasks : [],
      savedMemories: Array.isArray(result.savedMemories) ? result.savedMemories : [],
      modelChoice: result.modelChoice,
      modelLabel: result.modelLabel,
      fastMode: result.fastMode,
      selfReviewApplied: result.selfReviewApplied,
      codeVerification: result.codeVerification,
      webSources: result.webSources,
      searchQueries: result.searchQueries,
      elapsedMs: result.elapsedMs,
      usage: updatedAccount.usage,
    };

    chatJobStore.completeJob(job.id, finalPayload);

    writeFrame({
      type: 'done',
      payload: finalPayload,
    });
  } catch (err) {
    const rawMsg = err instanceof Error ? err.message : 'Agent request failed.';
    const safeMsg = redactSecrets(rawMsg);
    const isRateLimit = err instanceof GeminiRateLimitError || /429|rate limit|quota/i.test(safeMsg);
    const code =
      safeMsg.includes('API_KEY') || safeMsg.includes('GEMINI_API_KEY')
        ? 'CONFIG_ERROR'
        : isRateLimit
          ? 'RATE_LIMITED'
          : 'UPSTREAM_ERROR';
    const retryAfterSec =
      err instanceof GeminiRateLimitError ? err.retryAfterSec : isRateLimit ? 20 : undefined;
    const attemptsMade =
      err instanceof GeminiRateLimitError ? err.attemptsMade : undefined;
    chatJobStore.failJob(job.id, safeMsg, code, { retryAfterSec, attemptsMade });
    writeFrame({
      type: 'error',
      error: safeMsg,
      code,
      ...(retryAfterSec !== undefined ? { retryAfterSec } : {}),
      ...(attemptsMade !== undefined ? { attemptsMade } : {}),
    });
  } finally {
    clearInterval(heartbeat);
    if (!res.writableEnded && !res.destroyed) {
      res.end();
    }
  }
});

// Decoupled background job endpoint: returns jobId + jobToken in <20ms so long builds,
// multi-pass verification loops, and mobile/iframe reverse proxies NEVER truncate the response.
app.post('/api/agent/chat/jobs', async (req, res) => {
  const userId = await resolveRequestUserId(req, res);
  const parsed = parseChatBody((req.body ?? {}) as Record<string, unknown>);

  if (!parsed.message && parsed.attachments.length === 0) {
    res
      .status(400)
      .json({ error: 'Enter a message or attach a file/image.', code: 'EMPTY_MESSAGE' });
    return;
  }

  const allowance = userStore.checkMessageAllowance(userId, parsed.modelChoice);
  if (!allowance.allowed) {
    res.status(allowance.status).json({
      error: allowance.error,
      code: allowance.code,
    });
    return;
  }

  const job = chatJobStore.createJob(userId);
  const gmailRec = tokenVault.getToken(userId, 'gmail');
  const driveRec = tokenVault.getToken(userId, 'drive');

  // Respond immediately so reverse proxies / mobile networks never time out waiting for headers
  res.setHeader('Cache-Control', 'no-store');
  res.status(202).json({
    jobId: job.id,
    jobToken: job.token,
  });

  // Execute agent turn asynchronously in background detached from HTTP connection lifecycle
  void (async () => {
    try {
      const result = await runAgentChatTurn({
        userId,
        history: parsed.history,
        message: parsed.message,
        mode: parsed.mode,
        plan: allowance.record.plan,
        modelChoice: parsed.modelChoice,
        fastMode: parsed.fastMode,
        debugLoop: parsed.debugLoop,
        memoryEnabled: parsed.memoryEnabled,
        customInstructions: parsed.customInstructions,
        skipAutoCodeVerify: parsed.skipAutoCodeVerify,
        attachments: parsed.attachments,
        creds: {
          gmailToken: gmailRec?.accessToken,
          driveToken: driveRec?.accessToken,
        },
        onEvent: (event) => {
          if (event.type === 'task') {
            chatJobStore.upsertTask(job.id, event.task);
          } else if (event.type === 'delta') {
            chatJobStore.appendDelta(job.id, event.text);
          } else if (event.type === 'replace') {
            chatJobStore.replaceText(job.id, event.text);
          } else if (event.type === 'memory') {
            chatJobStore.addMemory(job.id, event.fact);
          }
        },
      });

      const updatedAccount = userStore.recordMessageUsage(userId);
      const finalPayload: Record<string, unknown> = {
        reply: result.reply ?? '',
        createdActions: Array.isArray(result.createdActions) ? result.createdActions : [],
        toolsUsed: Array.isArray(result.toolsUsed) ? result.toolsUsed : [],
        injectionAlerts: Array.isArray(result.injectionAlerts) ? result.injectionAlerts : [],
        tasks: Array.isArray(result.tasks) ? result.tasks : [],
        savedMemories: Array.isArray(result.savedMemories) ? result.savedMemories : [],
        modelChoice: result.modelChoice,
        modelLabel: result.modelLabel,
        fastMode: result.fastMode,
        selfReviewApplied: result.selfReviewApplied,
        codeVerification: result.codeVerification,
        webSources: result.webSources,
        searchQueries: result.searchQueries,
        elapsedMs: result.elapsedMs,
        usage: updatedAccount.usage,
      };
      chatJobStore.completeJob(job.id, finalPayload);
    } catch (err) {
      const rawMsg = err instanceof Error ? err.message : 'Agent request failed.';
      const safeMsg = redactSecrets(rawMsg);
      const isRateLimit =
        err instanceof GeminiRateLimitError || /429|rate limit|quota/i.test(safeMsg);
      const code =
        safeMsg.includes('API_KEY') || safeMsg.includes('GEMINI_API_KEY')
          ? 'CONFIG_ERROR'
          : isRateLimit
            ? 'RATE_LIMITED'
            : 'UPSTREAM_ERROR';
      const retryAfterSec =
        err instanceof GeminiRateLimitError ? err.retryAfterSec : isRateLimit ? 20 : undefined;
      const attemptsMade = err instanceof GeminiRateLimitError ? err.attemptsMade : undefined;
      chatJobStore.failJob(job.id, safeMsg, code, { retryAfterSec, attemptsMade });
    }
  })();
});

app.get('/api/agent/chat/jobs/:jobId', async (req, res) => {
  const userId = await resolveRequestUserId(req, res);
  const jobId = typeof req.params.jobId === 'string' ? req.params.jobId.trim() : '';
  if (!/^job_[a-f0-9]{12,40}$/.test(jobId)) {
    res.status(400).json({ error: 'Invalid job ID.', code: 'INVALID_JOB' });
    return;
  }
  const rawToken = req.headers['x-job-token'];
  const jobToken = typeof rawToken === 'string' ? rawToken.trim() : undefined;
  const job = chatJobStore.getJobForUser(jobId, userId, Date.now(), jobToken);
  if (!job) {
    res.status(404).json({ error: 'Generation job not found or expired.', code: 'JOB_NOT_FOUND' });
    return;
  }
  res.setHeader('Cache-Control', 'no-store');
  res.json({
    id: job.id,
    status: job.status,
    tasks: job.tasks,
    partialText: job.partialText,
    savedMemories: job.savedMemories,
    payload: job.payload,
    error: job.error,
    code: job.code,
    retryAfterSec: job.retryAfterSec,
    attemptsMade: job.attemptsMade,
  });
});

// ---------------- PREVIEW-FIRST APPROVAL QUEUE ----------------

app.get('/api/actions', (req, res) => {
  const userId = ensureUserId(req, res);
  res.json({ actions: listActionsForUser(userId) });
});

app.post('/api/actions', (req, res) => {
  const userId = ensureUserId(req, res);
  try {
    const body = (req.body ?? {}) as {
      type?: ActionType;
      title?: string;
      summary?: string;
      payload?: Record<string, unknown>;
      previewText?: string;
      riskLevel?: 'standard' | 'elevated';
      warning?: string;
    };

    if (!body.type || !body.title || !body.previewText || !body.payload) {
      res.status(400).json({ error: 'type, title, payload, and previewText are required.' });
      return;
    }
    if (isForbiddenDeleteAction(body.type)) {
      res.status(403).json({ error: 'Safety Rule: Deleting emails is permanently disabled.' });
      return;
    }

    const created = createPendingActionForUser(userId, {
      type: body.type,
      title: body.title.slice(0, 140),
      summary: (body.summary ?? '').slice(0, 200),
      payload: body.payload,
      previewText: body.previewText,
      riskLevel:
        body.riskLevel ??
        (body.type === 'drive_update_file' ||
        body.type === 'drive_delete_file' ||
        body.type === 'gmail_send_email'
          ? 'elevated'
          : 'standard'),
      warning: body.warning,
    });

    res.status(201).json({ action: created });
  } catch (err) {
    res.status(400).json({
      error: redactSecrets(err instanceof Error ? err.message : 'Could not queue action.'),
    });
  }
});

app.post('/api/actions/:id/approve', async (req, res) => {
  const userId = ensureUserId(req, res);
  try {
    const { confirmed } = (req.body ?? {}) as { confirmed?: boolean };

    if (confirmed !== true) {
      res.status(400).json({ error: 'Explicit approval (confirmed: true) is required.' });
      return;
    }

    const gmailRec = tokenVault.getToken(userId, 'gmail');
    const driveRec = tokenVault.getToken(userId, 'drive');

    const updated = await approveAndExecuteActionForUser(userId, req.params.id, {
      gmailToken: gmailRec?.accessToken,
      driveToken: driveRec?.accessToken,
    });

    res.json({ action: updated });
  } catch (err) {
    res.status(400).json({
      error: redactSecrets(err instanceof Error ? err.message : 'Approval execution failed.'),
    });
  }
});

app.post('/api/actions/:id/reject', (req, res) => {
  const userId = ensureUserId(req, res);
  try {
    const updated = rejectPendingActionForUser(userId, req.params.id);
    res.json({ action: updated });
  } catch (err) {
    res.status(400).json({
      error: redactSecrets(err instanceof Error ? err.message : 'Reject failed.'),
    });
  }
});

// ---------------- DIRECT READ-ONLY TOOL ROUTES (GMAIL + GOOGLE DRIVE) ----------------

app.get('/api/gmail/messages', async (req, res) => {
  const userId = ensureUserId(req, res);
  const gmailRec = tokenVault.getToken(userId, 'gmail');
  if (!gmailRec?.accessToken) {
    res.status(401).json({ error: 'Gmail is not connected. Click "Connect Gmail" first.' });
    return;
  }
  try {
    const q = typeof req.query.q === 'string' ? req.query.q : '';
    const messages = await searchGmailMessages(gmailRec.accessToken, q, 10);
    res.json({ messages: Array.isArray(messages) ? messages : [] });
  } catch (err) {
    res.status(502).json({ error: redactSecrets(err instanceof Error ? err.message : 'Gmail error') });
  }
});

app.get('/api/gmail/messages/:id', async (req, res) => {
  const userId = ensureUserId(req, res);
  const gmailRec = tokenVault.getToken(userId, 'gmail');
  if (!gmailRec?.accessToken) {
    res.status(401).json({ error: 'Gmail is not connected. Click "Connect Gmail" first.' });
    return;
  }
  try {
    const message = await readGmailMessage(gmailRec.accessToken, req.params.id);
    res.json({ message });
  } catch (err) {
    res.status(502).json({
      error: redactSecrets(err instanceof Error ? err.message : 'Gmail read error'),
    });
  }
});

app.get('/api/drive/files', async (req, res) => {
  const userId = ensureUserId(req, res);
  const driveRec = tokenVault.getToken(userId, 'drive');
  if (!driveRec?.accessToken) {
    res
      .status(401)
      .json({ error: 'Google Drive is not connected. Click "Connect Google Drive" first.' });
    return;
  }
  try {
    const q = typeof req.query.q === 'string' ? req.query.q : '';
    const files = await listDriveFiles(driveRec.accessToken, q, 25);
    res.json({
      folderName: IND_AGENT_DRIVE_FOLDER,
      files: Array.isArray(files) ? files : [],
    });
  } catch (err) {
    res.status(502).json({
      error: redactSecrets(err instanceof Error ? err.message : 'Google Drive error'),
    });
  }
});

app.get('/api/drive/files/:id', async (req, res) => {
  const userId = ensureUserId(req, res);
  const driveRec = tokenVault.getToken(userId, 'drive');
  if (!driveRec?.accessToken) {
    res
      .status(401)
      .json({ error: 'Google Drive is not connected. Click "Connect Google Drive" first.' });
    return;
  }
  try {
    const file = await readDriveFile(driveRec.accessToken, req.params.id);
    res.json({ file });
  } catch (err) {
    res.status(502).json({
      error: redactSecrets(err instanceof Error ? err.message : 'Google Drive read error'),
    });
  }
});

// Prevent unknown /api/* routes from falling through to SPA index.html
app.all('/api/*', (_req, res) => {
  res.status(404).json({ error: 'API endpoint not found.', code: 'NOT_FOUND' });
});

// ---------------- VITE / STATIC SERVING ----------------

async function startServer(): Promise<void> {
  const isProd = process.env.NODE_ENV === 'production';
  const distDir = path.resolve(process.cwd(), 'dist');

  if (!isProd || !fs.existsSync(distDir)) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: process.env.DISABLE_HMR !== 'true',
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  const httpServer = app.listen(PORT, '0.0.0.0', () => {
    console.log(`IND AGENT running on http://0.0.0.0:${PORT}`);
  });
  // Allow long-running IND HYPER streaming responses without Node prematurely cutting the socket
  httpServer.requestTimeout = 0;
  httpServer.keepAliveTimeout = 75_000;
  httpServer.headersTimeout = 80_000;
}

startServer().catch((err) => {
  console.error('Failed to start IND AGENT server:', err);
  process.exit(1);
});
