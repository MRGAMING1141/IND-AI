import type { ChatAttachment } from '../types/agent';

export const MAX_ATTACHMENTS_PER_MESSAGE = 4;
export const MAX_IMAGE_BYTES = 4 * 1024 * 1024; // 4 MB
export const MAX_FILE_BYTES = 2 * 1024 * 1024; // 2 MB
export const MAX_TEXT_FILE_CHARS = 120_000;

export const ALLOWED_IMAGE_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
]);

export const ALLOWED_BINARY_DOC_MIME_TYPES = new Set(['application/pdf']);

export const ALLOWED_TEXT_EXTENSIONS = new Set([
  '.txt',
  '.md',
  '.markdown',
  '.html',
  '.htm',
  '.css',
  '.js',
  '.mjs',
  '.cjs',
  '.ts',
  '.tsx',
  '.jsx',
  '.json',
  '.csv',
  '.xml',
  '.svg',
  '.py',
  '.lua',
  '.luau',
  '.sql',
  '.yaml',
  '.yml',
  '.sh',
  '.env',
  '.log',
]);

export function getFileExtension(name: string): string {
  const clean = name.trim().toLowerCase();
  const dot = clean.lastIndexOf('.');
  if (dot <= 0) return '';
  return clean.slice(dot);
}

export function isAllowedImageMime(mimeType: string): boolean {
  return ALLOWED_IMAGE_MIME_TYPES.has((mimeType || '').toLowerCase());
}

export function isAllowedTextFile(name: string, mimeType: string): boolean {
  const mime = (mimeType || '').toLowerCase();
  if (mime.startsWith('text/') || mime === 'application/json' || mime === 'application/xml') {
    return true;
  }
  const ext = getFileExtension(name);
  return ALLOWED_TEXT_EXTENSIONS.has(ext);
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function validateAttachmentCandidate(input: {
  name: string;
  mimeType: string;
  size: number;
  existingCount: number;
}): { ok: true; kind: 'image' | 'file'; isPdf: boolean } | { ok: false; error: string } {
  if (input.existingCount >= MAX_ATTACHMENTS_PER_MESSAGE) {
    return {
      ok: false,
      error: `You can attach up to ${MAX_ATTACHMENTS_PER_MESSAGE} files or images per message.`,
    };
  }

  const mime = (input.mimeType || '').toLowerCase();
  if (isAllowedImageMime(mime)) {
    if (input.size > MAX_IMAGE_BYTES) {
      return {
        ok: false,
        error: `"${input.name}" exceeds the ${formatBytes(MAX_IMAGE_BYTES)} image limit.`,
      };
    }
    return { ok: true, kind: 'image', isPdf: false };
  }

  if (ALLOWED_BINARY_DOC_MIME_TYPES.has(mime) || getFileExtension(input.name) === '.pdf') {
    if (input.size > MAX_IMAGE_BYTES) {
      return {
        ok: false,
        error: `"${input.name}" exceeds the ${formatBytes(MAX_IMAGE_BYTES)} PDF limit.`,
      };
    }
    return { ok: true, kind: 'file', isPdf: true };
  }

  if (isAllowedTextFile(input.name, mime)) {
    if (input.size > MAX_FILE_BYTES) {
      return {
        ok: false,
        error: `"${input.name}" exceeds the ${formatBytes(MAX_FILE_BYTES)} text/code file limit.`,
      };
    }
    return { ok: true, kind: 'file', isPdf: false };
  }

  return {
    ok: false,
    error: `Unsupported file type for "${input.name}". Upload images (PNG/JPG/WebP/GIF), PDF, or code/text files.`,
  };
}

/**
 * Strips heavy base64 payloads so saved chat history stays lightweight in localStorage.
 */
export function stripAttachmentPayloadsForHistory(
  attachments: ChatAttachment[] | undefined
): Array<Pick<ChatAttachment, 'id' | 'kind' | 'name' | 'mimeType' | 'size'>> | undefined {
  if (!Array.isArray(attachments) || attachments.length === 0) return undefined;
  return attachments.map((att) => ({
    id: att.id,
    kind: att.kind,
    name: att.name,
    mimeType: att.mimeType,
    size: att.size,
  }));
}
