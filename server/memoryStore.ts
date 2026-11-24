import crypto from 'node:crypto';
import type { MemoryFact } from '../src/types/agent.ts';

const MAX_MEMORY_FACTS_PER_USER = 40;
const MAX_FACT_LENGTH = 280;

export class MemoryStore {
  private readonly factsByUser = new Map<string, MemoryFact[]>();

  listFacts(userId: string): MemoryFact[] {
    const list = this.factsByUser.get(userId);
    if (!list) return [];
    return [...list];
  }

  addFact(
    userId: string,
    content: string,
    category: MemoryFact['category'] = 'context'
  ): MemoryFact {
    const cleaned = content.replace(/\s+/g, ' ').trim().slice(0, MAX_FACT_LENGTH);
    if (!cleaned) {
      throw new Error('Memory fact content cannot be empty.');
    }

    const list = this.factsByUser.get(userId) ?? [];
    const existing = list.find((f) => f.content.toLowerCase() === cleaned.toLowerCase());
    if (existing) {
      return existing;
    }

    const created: MemoryFact = {
      id: `mem_${crypto.randomBytes(5).toString('hex')}`,
      content: cleaned,
      category,
      createdAt: new Date().toISOString(),
    };

    const next = [created, ...list].slice(0, MAX_MEMORY_FACTS_PER_USER);
    this.factsByUser.set(userId, next);
    return created;
  }

  deleteFact(userId: string, factId: string): boolean {
    const list = this.factsByUser.get(userId);
    if (!list) return false;
    const filtered = list.filter((f) => f.id !== factId);
    if (filtered.length === list.length) return false;
    this.factsByUser.set(userId, filtered);
    return true;
  }

  clearFacts(userId: string): void {
    this.factsByUser.delete(userId);
  }
}

export const memoryStore = new MemoryStore();
