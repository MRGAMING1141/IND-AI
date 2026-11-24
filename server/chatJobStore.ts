import crypto from 'node:crypto';
import type { AgentTaskStep, MemoryFact } from '../src/types/agent.ts';

export type ChatJobStatus = 'running' | 'done' | 'error';

export interface ChatJobRecord {
  id: string;
  token: string;
  userId: string;
  status: ChatJobStatus;
  createdAtMs: number;
  updatedAtMs: number;
  tasks: AgentTaskStep[];
  partialText: string;
  savedMemories: MemoryFact[];
  payload?: Record<string, unknown>;
  error?: string;
  code?: string;
  retryAfterSec?: number;
  attemptsMade?: number;
}

const DEFAULT_TTL_MS = 20 * 60 * 1000;
const MAX_JOBS = 200;

function timingSafeHexEqual(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
  } catch {
    return false;
  }
}

export class ChatJobStore {
  private readonly jobs = new Map<string, ChatJobRecord>();
  private readonly ttlMs: number;

  constructor(ttlMs = DEFAULT_TTL_MS) {
    this.ttlMs = ttlMs;
  }

  private prune(nowMs: number): void {
    for (const [id, rec] of this.jobs.entries()) {
      if (nowMs - rec.updatedAtMs > this.ttlMs) {
        this.jobs.delete(id);
      }
    }
    if (this.jobs.size > MAX_JOBS) {
      const sorted = Array.from(this.jobs.values()).sort((a, b) => a.updatedAtMs - b.updatedAtMs);
      const excess = this.jobs.size - MAX_JOBS;
      for (let i = 0; i < excess; i += 1) {
        this.jobs.delete(sorted[i].id);
      }
    }
  }

  createJob(userId: string, nowMs = Date.now()): ChatJobRecord {
    this.prune(nowMs);
    const id = `job_${crypto.randomBytes(10).toString('hex')}`;
    const token = crypto.randomBytes(24).toString('hex');
    const record: ChatJobRecord = {
      id,
      token,
      userId,
      status: 'running',
      createdAtMs: nowMs,
      updatedAtMs: nowMs,
      tasks: [],
      partialText: '',
      savedMemories: [],
    };
    this.jobs.set(id, record);
    return record;
  }

  upsertTask(jobId: string, task: AgentTaskStep, nowMs = Date.now()): void {
    const rec = this.jobs.get(jobId);
    if (!rec || rec.status !== 'running') return;
    const idx = rec.tasks.findIndex((t) => t.id === task.id);
    if (idx >= 0) {
      rec.tasks[idx] = { ...task };
    } else {
      rec.tasks.push({ ...task });
    }
    rec.updatedAtMs = nowMs;
  }

  appendDelta(jobId: string, chunk: string, nowMs = Date.now()): void {
    const rec = this.jobs.get(jobId);
    if (!rec || rec.status !== 'running' || !chunk) return;
    rec.partialText += chunk;
    rec.updatedAtMs = nowMs;
  }

  replaceText(jobId: string, text: string, nowMs = Date.now()): void {
    const rec = this.jobs.get(jobId);
    if (!rec || rec.status !== 'running') return;
    rec.partialText = text;
    rec.updatedAtMs = nowMs;
  }

  addMemory(jobId: string, fact: MemoryFact, nowMs = Date.now()): void {
    const rec = this.jobs.get(jobId);
    if (!rec || rec.status !== 'running') return;
    if (!rec.savedMemories.some((m) => m.id === fact.id)) {
      rec.savedMemories.push({ ...fact });
    }
    rec.updatedAtMs = nowMs;
  }

  completeJob(jobId: string, payload: Record<string, unknown>, nowMs = Date.now()): void {
    const rec = this.jobs.get(jobId);
    if (!rec) return;
    rec.status = 'done';
    rec.payload = payload;
    rec.updatedAtMs = nowMs;
  }

  failJob(
    jobId: string,
    error: string,
    code: string,
    extra?: { retryAfterSec?: number; attemptsMade?: number },
    nowMs = Date.now()
  ): void {
    const rec = this.jobs.get(jobId);
    if (!rec) return;
    rec.status = 'error';
    rec.error = error;
    rec.code = code;
    rec.retryAfterSec = extra?.retryAfterSec;
    rec.attemptsMade = extra?.attemptsMade;
    rec.updatedAtMs = nowMs;
  }

  getJobForUser(
    jobId: string,
    userId: string,
    nowMs = Date.now(),
    jobToken?: string
  ): ChatJobRecord | null {
    this.prune(nowMs);
    const rec = this.jobs.get(jobId);
    if (!rec) return null;
    const ownerMatch = rec.userId === userId;
    const tokenMatch =
      typeof jobToken === 'string' && jobToken.length >= 32 && timingSafeHexEqual(rec.token, jobToken);
    if (!ownerMatch && !tokenMatch) return null;
    return rec;
  }
}

export const chatJobStore = new ChatJobStore();
