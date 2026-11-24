import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  limit,
  onSnapshot,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
  writeBatch,
  type Unsubscribe,
} from 'firebase/firestore';
import type { User } from 'firebase/auth';
import { db, handleFirestoreError, OperationType } from './firebase';
import { clampCustomInstructions, MAX_SKILL_INSTRUCTIONS_CHARS } from '../utils/skillsEngine';
import {
  PLUS_PRICE_INR,
  computeNewPlanExpiryMs,
  isAdminEmail,
  isPlusSubscriptionActive,
  isValidPayeeName,
  isValidUpiId,
  isValidUtr,
  normalizeUpiId,
  normalizeUtr,
} from '../utils/paymentEngine';
import { evaluateUsageWindow } from '../utils/planEngine';
import type {
  AgentMode,
  BillingSettings,
  ChatMessage,
  ChatSession,
  CustomInstructionsConfig,
  MemoryFact,
  PaymentRequestRecord,
  SkillDefinition,
  UserPlan,
} from '../types/agent';

const SAFE_ID_REGEX = /^[a-zA-Z0-9_-]{1,128}$/;

function toSafeDocId(raw: string, prefix: string): string {
  const cleaned = raw.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 120);
  if (SAFE_ID_REGEX.test(cleaned)) return cleaned;
  return `${prefix}_${Date.now()}`;
}

function timestampToIso(value: unknown): string {
  if (value instanceof Timestamp) return value.toDate().toISOString();
  if (typeof value === 'string' && value.trim()) return value;
  return new Date().toISOString();
}

export interface CloudUserProfile {
  uid: string;
  email: string;
  displayName: string;
  photoURL?: string;
  plan: UserPlan;
  planExpiresAt: number;
  customInstructions: string;
  customInstructionsEnabled: boolean;
  usageWindowStart: number;
  usageWindowCount: number;
}

function parseSafeInt(value: unknown, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return 0;
  return Math.min(max, Math.floor(value));
}

/**
 * Ensures the parent `/users/{uid}` document exists (required by Firestore security rules
 * master gate `hasParentUser(userId)` before any subcollection write).
 */
export async function ensureCloudUserProfile(
  user: User,
  localCustomInstructions?: CustomInstructionsConfig
): Promise<CloudUserProfile> {
  const userPath = `users/${user.uid}`;
  const ref = doc(db, 'users', user.uid);
  const safeEmail = (user.email || 'user@example.com').slice(0, 254);
  const safeName = (user.displayName || safeEmail.split('@')[0] || 'IND AGENT User').slice(0, 120);
  const safePhoto = user.photoURL ? user.photoURL.slice(0, 512) : undefined;

  try {
    const ownerAccount = isAdminEmail(safeEmail) && user.emailVerified === true;
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      const ciText = clampCustomInstructions(localCustomInstructions?.text ?? '');
      const ciEnabled = localCustomInstructions?.enabled ?? true;
      const initialPlan: UserPlan = ownerAccount ? 'plus' : 'free';
      const createPayload: Record<string, unknown> = {
        uid: user.uid,
        email: safeEmail,
        displayName: safeName,
        plan: initialPlan,
        planExpiresAt: 0,
        customInstructions: ciText,
        customInstructionsEnabled: ciEnabled,
        usageWindowStart: 0,
        usageWindowCount: 0,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
      if (safePhoto) {
        createPayload.photoURL = safePhoto;
      }
      await setDoc(ref, createPayload);
      return {
        uid: user.uid,
        email: safeEmail,
        displayName: safeName,
        photoURL: safePhoto,
        plan: initialPlan,
        planExpiresAt: 0,
        customInstructions: ciText,
        customInstructionsEnabled: ciEnabled,
        usageWindowStart: 0,
        usageWindowCount: 0,
      };
    }

    const existing = snap.data();
    const updatePayload: Record<string, unknown> = {
      email: safeEmail,
      displayName: safeName,
      updatedAt: serverTimestamp(),
    };
    if (safePhoto) {
      updatePayload.photoURL = safePhoto;
    }
    await updateDoc(ref, updatePayload);

    let rawPlan: UserPlan = existing.plan === 'plus' ? 'plus' : 'free';
    let planExpiresAt = parseSafeInt(existing.planExpiresAt, 9_999_999_999_999);

    // Grant owner account (ffonlypro@gmail.com) IND AGENT Plus automatically so IND HYPER is ready to test
    if (ownerAccount && rawPlan !== 'plus') {
      await updateDoc(ref, {
        plan: 'plus',
        planExpiresAt: 0,
        updatedAt: serverTimestamp(),
      });
      rawPlan = 'plus';
      planExpiresAt = 0;
    }

    const effectivePlan: UserPlan = isPlusSubscriptionActive(rawPlan, planExpiresAt) ? 'plus' : 'free';

    return {
      uid: user.uid,
      email: safeEmail,
      displayName: safeName,
      photoURL: safePhoto ?? (typeof existing.photoURL === 'string' ? existing.photoURL : undefined),
      plan: effectivePlan,
      planExpiresAt: effectivePlan === 'plus' ? planExpiresAt : 0,
      customInstructions:
        typeof existing.customInstructions === 'string'
          ? clampCustomInstructions(existing.customInstructions)
          : '',
      customInstructionsEnabled: existing.customInstructionsEnabled !== false,
      usageWindowStart: parseSafeInt(existing.usageWindowStart, 9_999_999_999_999),
      usageWindowCount: parseSafeInt(existing.usageWindowCount, 10_000),
    };
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, userPath);
  }
}

/**
 * Owner-only helper allowing ffonlypro@gmail.com to toggle between Plus (IND HYPER) and Free for testing.
 */
export async function setOwnerTestingPlan(uid: string, plan: UserPlan): Promise<void> {
  const userPath = `users/${uid}`;
  try {
    await updateDoc(doc(db, 'users', uid), {
      plan,
      planExpiresAt: 0,
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, userPath);
  }
}

export async function saveCloudCustomInstructions(
  uid: string,
  config: CustomInstructionsConfig
): Promise<void> {
  const userPath = `users/${uid}`;
  try {
    const ref = doc(db, 'users', uid);
    await updateDoc(ref, {
      customInstructions: clampCustomInstructions(config.text),
      customInstructionsEnabled: Boolean(config.enabled),
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, userPath);
  }
}

/**
 * Persists the user's 5-hour rolling usage window to Firestore `/users/{uid}`
 * inside a transaction so it never violates monotonic rules even after server restarts.
 */
export async function saveCloudUsageWindow(
  uid: string,
  windowStartedAtMs: number,
  windowMessagesUsed: number
): Promise<{ windowStartedAtMs: number; used: number; resetsAt: string | null }> {
  const userPath = `users/${uid}`;
  const ref = doc(db, 'users', uid);
  const incomingStart = parseSafeInt(windowStartedAtMs, 9_999_999_999_999);
  const incomingCount = parseSafeInt(windowMessagesUsed, 10_000);
  const nowMs = Date.now();

  try {
    return await runTransaction(db, async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists()) {
        return { windowStartedAtMs: 0, used: 0, resetsAt: null };
      }
      const data = snap.data();
      const existingStart = parseSafeInt(data.usageWindowStart, 9_999_999_999_999);
      const existingCount = parseSafeInt(data.usageWindowCount, 10_000);
      const existingEval = evaluateUsageWindow(existingStart, existingCount, nowMs);

      let nextStart = existingEval.windowStartedAtMs;
      let nextCount = existingEval.used;

      if (existingEval.windowStartedAtMs <= 0 || existingEval.used <= 0) {
        // Previous window expired or empty — adopt incoming active window
        const inEval = evaluateUsageWindow(incomingStart || nowMs, incomingCount, nowMs);
        nextStart = inEval.windowStartedAtMs || (incomingCount > 0 ? nowMs : 0);
        nextCount = inEval.used;
      } else {
        // Active Firestore window exists — ALWAYS preserve existingStart and take max count
        nextStart = existingEval.windowStartedAtMs;
        nextCount = Math.max(existingEval.used, incomingCount);
      }

      if (nextStart !== existingStart || nextCount !== existingCount) {
        tx.update(ref, {
          usageWindowStart: nextStart,
          usageWindowCount: nextCount,
          updatedAt: serverTimestamp(),
        });
      }

      const finalEval = evaluateUsageWindow(nextStart, nextCount, nowMs);
      return {
        windowStartedAtMs: finalEval.windowStartedAtMs,
        used: finalEval.used,
        resetsAt: finalEval.resetsAt,
      };
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, userPath);
  }
}

/**
 * Atomically increments the user's 5-hour rolling usage counter in Firestore `/users/{uid}`.
 * Guaranteed to survive server restarts, mobile iframe cookie resets, and multiple open tabs.
 */
export async function incrementCloudUsageWindow(
  uid: string
): Promise<{ windowStartedAtMs: number; used: number; resetsAt: string | null }> {
  const userPath = `users/${uid}`;
  const ref = doc(db, 'users', uid);
  const nowMs = Date.now();

  try {
    return await runTransaction(db, async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists()) {
        return { windowStartedAtMs: 0, used: 0, resetsAt: null };
      }
      const data = snap.data();
      const existingStart = parseSafeInt(data.usageWindowStart, 9_999_999_999_999);
      const existingCount = parseSafeInt(data.usageWindowCount, 10_000);
      const existingEval = evaluateUsageWindow(existingStart, existingCount, nowMs);

      const nextStart =
        existingEval.windowStartedAtMs > 0 && existingEval.used > 0
          ? existingEval.windowStartedAtMs
          : nowMs;
      const nextCount =
        existingEval.windowStartedAtMs > 0 && existingEval.used > 0
          ? Math.min(10_000, existingEval.used + 1)
          : 1;

      tx.update(ref, {
        usageWindowStart: nextStart,
        usageWindowCount: nextCount,
        updatedAt: serverTimestamp(),
      });

      const finalEval = evaluateUsageWindow(nextStart, nextCount, nowMs);
      return {
        windowStartedAtMs: finalEval.windowStartedAtMs,
        used: finalEval.used,
        resetsAt: finalEval.resetsAt,
      };
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, userPath);
  }
}

export function subscribeCloudProfile(
  uid: string,
  onProfile: (profile: CloudUserProfile) => void
): Unsubscribe {
  const userPath = `users/${uid}`;
  const ref = doc(db, 'users', uid);
  return onSnapshot(
    ref,
    (snap) => {
      if (!snap.exists()) return;
      const d = snap.data();
      const rawPlan: UserPlan = d.plan === 'plus' ? 'plus' : 'free';
      const planExpiresAt = parseSafeInt(d.planExpiresAt, 9_999_999_999_999);
      const effectivePlan: UserPlan = isPlusSubscriptionActive(rawPlan, planExpiresAt) ? 'plus' : 'free';
      onProfile({
        uid: typeof d.uid === 'string' ? d.uid : uid,
        email: typeof d.email === 'string' ? d.email : '',
        displayName: typeof d.displayName === 'string' ? d.displayName : 'IND AGENT User',
        photoURL: typeof d.photoURL === 'string' ? d.photoURL : undefined,
        plan: effectivePlan,
        planExpiresAt: effectivePlan === 'plus' ? planExpiresAt : 0,
        customInstructions:
          typeof d.customInstructions === 'string'
            ? clampCustomInstructions(d.customInstructions)
            : '',
        customInstructionsEnabled: d.customInstructionsEnabled !== false,
        usageWindowStart: parseSafeInt(d.usageWindowStart, 9_999_999_999_999),
        usageWindowCount: parseSafeInt(d.usageWindowCount, 10_000),
      });
    },
    (err) => {
      handleFirestoreError(err, OperationType.GET, userPath);
    }
  );
}

// ---------------- FAMPAY / UPI BILLING & PAYMENT VERIFICATION ----------------

export function subscribeBillingSettings(
  onSettings: (settings: BillingSettings | null) => void
): Unsubscribe {
  const ref = doc(db, 'settings', 'billing');
  return onSnapshot(
    ref,
    (snap) => {
      if (!snap.exists()) {
        onSettings(null);
        return;
      }
      const d = snap.data();
      onSettings({
        upiId: typeof d.upiId === 'string' ? d.upiId : '',
        payeeName: typeof d.payeeName === 'string' && d.payeeName ? d.payeeName : 'IND AGENT',
        priceInr:
          typeof d.priceInr === 'number' && Number.isFinite(d.priceInr)
            ? d.priceInr
            : PLUS_PRICE_INR,
        updatedAt: timestampToIso(d.updatedAt),
      });
    },
    () => {
      // Non-fatal if billing doc hasn't been created yet
      onSettings(null);
    }
  );
}

export async function saveBillingSettings(upiId: string, payeeName: string): Promise<void> {
  const cleanUpi = normalizeUpiId(upiId);
  const cleanPayee = payeeName.trim().slice(0, 60);
  if (!isValidUpiId(cleanUpi)) {
    throw new Error('Enter a valid FamPay or UPI ID (example: yourname@fam).');
  }
  if (!isValidPayeeName(cleanPayee)) {
    throw new Error('Payee name must be 2–60 characters.');
  }
  const path = 'settings/billing';
  try {
    await setDoc(doc(db, 'settings', 'billing'), {
      upiId: cleanUpi,
      payeeName: cleanPayee,
      priceInr: PLUS_PRICE_INR,
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, path);
  }
}

export async function submitPaymentRequest(input: {
  uid: string;
  email: string;
  displayName: string;
  utr: string;
  payerUpi?: string;
}): Promise<string> {
  const cleanUtr = normalizeUtr(input.utr);
  if (!isValidUtr(cleanUtr)) {
    throw new Error('Enter a valid 10–24 character UPI UTR / Reference number (usually 12 digits).');
  }
  const cleanPayerUpi = input.payerUpi?.trim().slice(0, 98) || '';
  const requestId = `pay_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const path = `paymentRequests/${requestId}`;

  const payload: Record<string, unknown> = {
    id: requestId,
    userId: input.uid,
    userEmail: (input.email || 'user@example.com').slice(0, 254),
    userName: (input.displayName || 'IND AGENT User').slice(0, 120),
    plan: 'plus',
    amountInr: PLUS_PRICE_INR,
    utr: cleanUtr,
    status: 'pending',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
  if (cleanPayerUpi) {
    payload.payerUpi = cleanPayerUpi;
  }

  try {
    await setDoc(doc(db, 'paymentRequests', requestId), payload);
    return requestId;
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, path);
  }
}

function mapPaymentRequestDoc(docId: string, d: Record<string, unknown>): PaymentRequestRecord {
  const status =
    d.status === 'approved' || d.status === 'rejected' ? d.status : 'pending';
  return {
    id: typeof d.id === 'string' ? d.id : docId,
    userId: typeof d.userId === 'string' ? d.userId : '',
    userEmail: typeof d.userEmail === 'string' ? d.userEmail : '',
    userName: typeof d.userName === 'string' ? d.userName : 'IND AGENT User',
    plan: 'plus',
    amountInr:
      typeof d.amountInr === 'number' && Number.isFinite(d.amountInr)
        ? d.amountInr
        : PLUS_PRICE_INR,
    utr: typeof d.utr === 'string' ? d.utr : '',
    payerUpi: typeof d.payerUpi === 'string' ? d.payerUpi : undefined,
    status,
    adminNote: typeof d.adminNote === 'string' ? d.adminNote : undefined,
    createdAt: timestampToIso(d.createdAt),
    updatedAt: timestampToIso(d.updatedAt),
  };
}

export function subscribeUserPaymentRequests(
  uid: string,
  onRequests: (requests: PaymentRequestRecord[]) => void
): Unsubscribe {
  const path = 'paymentRequests';
  const q = query(collection(db, 'paymentRequests'), where('userId', '==', uid), limit(20));
  return onSnapshot(
    q,
    (snapshot) => {
      const items = snapshot.docs.map((snap) =>
        mapPaymentRequestDoc(snap.id, snap.data() as Record<string, unknown>)
      );
      items.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      onRequests(items);
    },
    (err) => {
      handleFirestoreError(err, OperationType.LIST, path);
    }
  );
}

export function subscribeAllPaymentRequests(
  onRequests: (requests: PaymentRequestRecord[]) => void
): Unsubscribe {
  const path = 'paymentRequests';
  const q = query(collection(db, 'paymentRequests'), limit(50));
  return onSnapshot(
    q,
    (snapshot) => {
      const items = snapshot.docs.map((snap) =>
        mapPaymentRequestDoc(snap.id, snap.data() as Record<string, unknown>)
      );
      items.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      onRequests(items);
    },
    (err) => {
      handleFirestoreError(err, OperationType.LIST, path);
    }
  );
}

/**
 * Owner-Admin action: atomically approves or rejects a pending UPI payment request
 * and (when approved) activates IND AGENT Plus for 30 days on `/users/{targetUid}`.
 */
export async function reviewPaymentRequestAndActivatePlan(input: {
  request: PaymentRequestRecord;
  decision: 'approved' | 'rejected';
  adminNote?: string;
}): Promise<{ planExpiresAt?: number }> {
  const { request, decision } = input;
  const cleanNote = (input.adminNote ?? '').trim().slice(0, 240);
  const reqRef = doc(db, 'paymentRequests', request.id);
  const path = `paymentRequests/${request.id}`;

  try {
    const batch = writeBatch(db);
    let nextExpiry: number | undefined;

    if (decision === 'approved') {
      const userRef = doc(db, 'users', request.userId);
      const userSnap = await getDoc(userRef);
      const existingExpiry = userSnap.exists()
        ? parseSafeInt(userSnap.data().planExpiresAt, 9_999_999_999_999)
        : 0;
      nextExpiry = computeNewPlanExpiryMs(existingExpiry);

      batch.update(userRef, {
        plan: 'plus',
        planExpiresAt: nextExpiry,
        updatedAt: serverTimestamp(),
      });
    }

    batch.update(reqRef, {
      status: decision,
      adminNote: cleanNote || (decision === 'approved' ? 'Verified via FamPay UPI' : 'UTR could not be matched'),
      updatedAt: serverTimestamp(),
    });

    await batch.commit();
    return { planExpiresAt: nextExpiry };
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

// ---------------- CHAT SESSIONS ----------------

function sanitizeMessagesForCloud(messages: ChatMessage[]): Array<Record<string, unknown>> {
  return messages.slice(-100).map((m) => {
    const clean: Record<string, unknown> = {
      id: String(m.id || `m_${Date.now()}`).slice(0, 64),
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: String(m.content ?? '').slice(0, 8000),
      mode: m.mode === 'coding' || m.mode === 'business' ? m.mode : 'auto',
      createdAt: m.createdAt || new Date().toISOString(),
    };
    if (m.modelChoice) clean.modelChoice = m.modelChoice;
    if (m.modelLabel) clean.modelLabel = m.modelLabel.slice(0, 80);
    if (typeof m.fastMode === 'boolean') clean.fastMode = m.fastMode;
    if (typeof m.elapsedMs === 'number') clean.elapsedMs = m.elapsedMs;
    if (m.skillCommand) clean.skillCommand = m.skillCommand.slice(0, 24);
    if (m.error) {
      clean.error = true;
      if (m.errorTitle) clean.errorTitle = m.errorTitle.slice(0, 100);
    }
    if (Array.isArray(m.attachments) && m.attachments.length > 0) {
      clean.attachments = m.attachments.slice(0, 4).map((a) => ({
        id: String(a.id).slice(0, 64),
        kind: a.kind === 'image' ? 'image' : 'file',
        name: String(a.name).slice(0, 120),
        mimeType: String(a.mimeType).slice(0, 80),
        size: Number(a.size) || 0,
      }));
    }
    return clean;
  });
}

export async function saveCloudSession(uid: string, session: ChatSession): Promise<void> {
  const safeId = toSafeDocId(session.id, 'chat');
  const sessionPath = `users/${uid}/sessions/${safeId}`;
  const ref = doc(db, 'users', uid, 'sessions', safeId);
  const safeTitle = (session.title || 'New chat').trim().slice(0, 140) || 'New chat';
  const safeMode: AgentMode =
    session.mode === 'coding' || session.mode === 'business' ? session.mode : 'auto';
  const safeMessages = sanitizeMessagesForCloud(session.messages);

  try {
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      await setDoc(ref, {
        id: safeId,
        ownerId: uid,
        title: safeTitle,
        mode: safeMode,
        messages: safeMessages,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      await updateDoc(ref, {
        title: safeTitle,
        mode: safeMode,
        messages: safeMessages,
        updatedAt: serverTimestamp(),
      });
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, sessionPath);
  }
}

export async function deleteCloudSession(uid: string, sessionId: string): Promise<void> {
  const safeId = toSafeDocId(sessionId, 'chat');
  const sessionPath = `users/${uid}/sessions/${safeId}`;
  try {
    await deleteDoc(doc(db, 'users', uid, 'sessions', safeId));
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, sessionPath);
  }
}

export function subscribeCloudSessions(
  uid: string,
  onSessions: (sessions: ChatSession[]) => void
): Unsubscribe {
  const path = `users/${uid}/sessions`;
  const q = query(
    collection(db, 'users', uid, 'sessions'),
    where('ownerId', '==', uid),
    limit(25)
  );
  return onSnapshot(
    q,
    (snapshot) => {
      const items: ChatSession[] = snapshot.docs.map((docSnap) => {
        const d = docSnap.data();
        return {
          id: typeof d.id === 'string' ? d.id : docSnap.id,
          title: typeof d.title === 'string' ? d.title : 'IND AGENT Chat',
          mode: d.mode === 'coding' || d.mode === 'business' ? d.mode : 'auto',
          updatedAt: timestampToIso(d.updatedAt),
          messages: Array.isArray(d.messages) ? (d.messages as ChatMessage[]) : [],
        };
      });
      items.sort(
        (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
      );
      onSessions(items);
    },
    (err) => {
      handleFirestoreError(err, OperationType.LIST, path);
    }
  );
}

// ---------------- MEMORY FACTS ----------------

export async function saveCloudMemoryFact(uid: string, fact: MemoryFact): Promise<void> {
  const safeId = toSafeDocId(fact.id, 'mem');
  const path = `users/${uid}/memories/${safeId}`;
  const safeContent = fact.content.trim().slice(0, 240);
  if (!safeContent) return;
  const safeCat: MemoryFact['category'] =
    fact.category === 'preference' || fact.category === 'project' ? fact.category : 'context';

  try {
    await setDoc(doc(db, 'users', uid, 'memories', safeId), {
      id: safeId,
      ownerId: uid,
      content: safeContent,
      category: safeCat,
      createdAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, path);
  }
}

export async function deleteCloudMemoryFact(uid: string, memoryId: string): Promise<void> {
  const safeId = toSafeDocId(memoryId, 'mem');
  const path = `users/${uid}/memories/${safeId}`;
  try {
    await deleteDoc(doc(db, 'users', uid, 'memories', safeId));
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, path);
  }
}

export function subscribeCloudMemories(
  uid: string,
  onMemories: (facts: MemoryFact[]) => void
): Unsubscribe {
  const path = `users/${uid}/memories`;
  const q = query(
    collection(db, 'users', uid, 'memories'),
    where('ownerId', '==', uid),
    limit(50)
  );
  return onSnapshot(
    q,
    (snapshot) => {
      const facts: MemoryFact[] = snapshot.docs.map((docSnap) => {
        const d = docSnap.data();
        return {
          id: typeof d.id === 'string' ? d.id : docSnap.id,
          content: typeof d.content === 'string' ? d.content : '',
          category:
            d.category === 'preference' || d.category === 'project' ? d.category : 'context',
          createdAt: timestampToIso(d.createdAt),
        };
      });
      facts.sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
      onMemories(facts);
    },
    (err) => {
      handleFirestoreError(err, OperationType.LIST, path);
    }
  );
}

// ---------------- CUSTOM SKILLS ----------------

export async function saveCloudSkill(uid: string, skill: SkillDefinition): Promise<void> {
  const safeId = toSafeDocId(skill.id, 'skill');
  const path = `users/${uid}/skills/${safeId}`;
  const ref = doc(db, 'users', uid, 'skills', safeId);

  const safeFields: Record<string, unknown> = {
    command: skill.command.slice(0, 24),
    name: skill.name.trim().slice(0, 60),
    description: skill.description.trim().slice(0, 180),
    mode: skill.mode === 'coding' || skill.mode === 'business' ? skill.mode : 'auto',
    instructions: skill.instructions.trim().slice(0, MAX_SKILL_INSTRUCTIONS_CHARS),
    updatedAt: serverTimestamp(),
  };
  if (skill.placeholder?.trim()) {
    safeFields.placeholder = skill.placeholder.trim().slice(0, 160);
  }

  try {
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      await setDoc(ref, {
        id: safeId,
        ownerId: uid,
        ...safeFields,
        createdAt: serverTimestamp(),
      });
    } else {
      await updateDoc(ref, safeFields);
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, path);
  }
}

export async function deleteCloudSkill(uid: string, skillId: string): Promise<void> {
  const safeId = toSafeDocId(skillId, 'skill');
  const path = `users/${uid}/skills/${safeId}`;
  try {
    await deleteDoc(doc(db, 'users', uid, 'skills', safeId));
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, path);
  }
}

export function subscribeCloudSkills(
  uid: string,
  onSkills: (skills: SkillDefinition[]) => void
): Unsubscribe {
  const path = `users/${uid}/skills`;
  const q = query(
    collection(db, 'users', uid, 'skills'),
    where('ownerId', '==', uid),
    limit(40)
  );
  return onSnapshot(
    q,
    (snapshot) => {
      const list: SkillDefinition[] = snapshot.docs.map((docSnap) => {
        const d = docSnap.data();
        return {
          id: typeof d.id === 'string' ? d.id : docSnap.id,
          command: typeof d.command === 'string' ? d.command : '/custom',
          name: typeof d.name === 'string' ? d.name : 'Custom Skill',
          description: typeof d.description === 'string' ? d.description : '',
          mode: d.mode === 'coding' || d.mode === 'business' ? d.mode : 'auto',
          instructions: typeof d.instructions === 'string' ? d.instructions : '',
          placeholder: typeof d.placeholder === 'string' ? d.placeholder : undefined,
          builtIn: false,
        };
      });
      onSkills(list);
    },
    (err) => {
      handleFirestoreError(err, OperationType.LIST, path);
    }
  );
}
