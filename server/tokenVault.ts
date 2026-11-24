import crypto from 'node:crypto';

export type OAuthProvider = 'gmail' | 'drive';

export interface StoredProviderRecord {
  accessToken: string;
  accountLabel?: string;
  connectedAt: string;
}

interface EncryptedBlob {
  iv: string;
  authTag: string;
  ciphertext: string;
}

interface UserVaultEntry {
  providers: Partial<Record<OAuthProvider, EncryptedBlob>>;
  updatedAt: number;
}

const EPHEMERAL_FALLBACK_KEY = crypto.randomBytes(32);

function deriveEncryptionKey(secretOverride?: string): Buffer {
  const raw = (secretOverride ?? process.env.TOKEN_ENCRYPTION_KEY ?? '').trim();
  if (raw) {
    return crypto.createHash('sha256').update(raw, 'utf8').digest();
  }
  return EPHEMERAL_FALLBACK_KEY;
}

export function encryptJson(data: unknown, secretOverride?: string): EncryptedBlob {
  const key = deriveEncryptionKey(secretOverride);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const plaintext = Buffer.from(JSON.stringify(data), 'utf8');
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return {
    iv: iv.toString('base64'),
    authTag: authTag.toString('base64'),
    ciphertext: encrypted.toString('base64'),
  };
}

export function decryptJson<T>(blob: EncryptedBlob, secretOverride?: string): T {
  const key = deriveEncryptionKey(secretOverride);
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    key,
    Buffer.from(blob.iv, 'base64')
  );
  decipher.setAuthTag(Buffer.from(blob.authTag, 'base64'));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(blob.ciphertext, 'base64')),
    decipher.final(),
  ]);
  return JSON.parse(decrypted.toString('utf8')) as T;
}

export class PerUserTokenVault {
  private readonly store = new Map<string, UserVaultEntry>();
  private readonly secretOverride?: string;

  constructor(secretOverride?: string) {
    this.secretOverride = secretOverride;
  }

  setToken(userId: string, provider: OAuthProvider, record: StoredProviderRecord): void {
    const existing = this.store.get(userId) ?? { providers: {}, updatedAt: Date.now() };
    existing.providers[provider] = encryptJson(record, this.secretOverride);
    existing.updatedAt = Date.now();
    this.store.set(userId, existing);
  }

  getToken(userId: string, provider: OAuthProvider): StoredProviderRecord | null {
    const entry = this.store.get(userId);
    const blob = entry?.providers[provider];
    if (!blob) return null;
    try {
      return decryptJson<StoredProviderRecord>(blob, this.secretOverride);
    } catch {
      return null;
    }
  }

  deleteToken(userId: string, provider: OAuthProvider): void {
    const entry = this.store.get(userId);
    if (!entry) return;
    delete entry.providers[provider];
    entry.updatedAt = Date.now();
  }

  /** Exposed strictly for unit testing ciphertext opacity */
  getRawCiphertextForTest(userId: string, provider: OAuthProvider): string | null {
    return this.store.get(userId)?.providers[provider]?.ciphertext ?? null;
  }
}

export const tokenVault = new PerUserTokenVault();
