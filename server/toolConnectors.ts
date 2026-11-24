import crypto from 'node:crypto';
import { detectPromptInjection, redactSecrets } from '../src/utils/safetyEngine.ts';
import type { DriveFileItem, GmailMessageItem } from '../src/types/agent.ts';

const GMAIL_API_BASE = 'https://gmail.googleapis.com/gmail/v1/users/me';
const DRIVE_API_BASE = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD_BASE = 'https://www.googleapis.com/upload/drive/v3';
export const IND_AGENT_DRIVE_FOLDER = 'IND AGENT';

function decodeBase64Url(data: string): string {
  const normalized = data.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(normalized, 'base64').toString('utf8');
}

function encodeBase64Url(data: string): string {
  return Buffer.from(data, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function sanitizeHeaderValue(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').trim();
}

function buildRfc2822Raw(to: string, subject: string, body: string): string {
  const safeTo = sanitizeHeaderValue(to);
  const safeSubject = sanitizeHeaderValue(subject);
  const message = [
    `To: ${safeTo}`,
    `Subject: =?UTF-8?B?${Buffer.from(safeSubject, 'utf8').toString('base64')}?=`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset="UTF-8"',
    '',
    body,
  ].join('\r\n');
  return encodeBase64Url(message);
}

interface GmailPart {
  mimeType?: string;
  body?: { data?: string };
  parts?: GmailPart[];
}

function extractGmailBody(payload?: GmailPart): string {
  if (!payload) return '';
  if (payload.mimeType === 'text/plain' && payload.body?.data) {
    return decodeBase64Url(payload.body.data);
  }
  if (Array.isArray(payload.parts)) {
    for (const part of payload.parts) {
      if (part?.mimeType === 'text/plain' && part.body?.data) {
        return decodeBase64Url(part.body.data);
      }
    }
    for (const part of payload.parts) {
      const nested = extractGmailBody(part);
      if (nested) return nested;
    }
  }
  if (payload.body?.data) {
    return decodeBase64Url(payload.body.data);
  }
  return '';
}

function getHeader(
  headers: Array<{ name: string; value: string }> | undefined,
  name: string
): string {
  if (!Array.isArray(headers)) return '';
  const match = headers.find((h) => h?.name?.toLowerCase() === name.toLowerCase());
  return match?.value ?? '';
}

// ---------------- GMAIL API ----------------

export async function searchGmailMessages(
  accessToken: string,
  query = '',
  maxResults = 8
): Promise<GmailMessageItem[]> {
  const clampedMax = Math.max(1, Math.min(15, Number(maxResults) || 8));
  const params = new URLSearchParams({ maxResults: String(clampedMax) });
  if (query.trim()) {
    params.set('q', query.trim());
  }

  const listRes = await fetch(`${GMAIL_API_BASE}/messages?${params.toString()}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!listRes.ok) {
    const errText = await listRes.text();
    throw new Error(`Gmail list error (${listRes.status}): ${redactSecrets(errText).slice(0, 200)}`);
  }

  const listJson = (await listRes.json().catch(() => ({}))) as {
    messages?: Array<{ id: string; threadId: string }>;
  };
  const refs = Array.isArray(listJson?.messages) ? listJson.messages : [];
  if (refs.length === 0) return [];

  const detailed = await Promise.all(
    refs.slice(0, clampedMax).map(async (ref): Promise<GmailMessageItem | null> => {
      if (!ref?.id) return null;
      const msgRes = await fetch(
        `${GMAIL_API_BASE}/messages/${encodeURIComponent(ref.id)}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Date`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      if (!msgRes.ok) return null;
      const msg = (await msgRes.json().catch(() => null)) as {
        id: string;
        threadId: string;
        snippet?: string;
        payload?: { headers?: Array<{ name: string; value: string }> };
      } | null;
      if (!msg?.id) return null;
      const subject = getHeader(msg.payload?.headers, 'Subject') || '(No subject)';
      const snippet = msg.snippet ?? '';
      const scan = detectPromptInjection(`${subject}\n${snippet}`);
      return {
        id: msg.id,
        threadId: msg.threadId ?? '',
        from: getHeader(msg.payload?.headers, 'From') || 'Unknown sender',
        to: getHeader(msg.payload?.headers, 'To'),
        subject,
        date: getHeader(msg.payload?.headers, 'Date'),
        snippet,
        injectionFlagged: scan.flagged,
        injectionMatches: scan.matches,
      };
    })
  );

  return detailed.filter((item): item is GmailMessageItem => item !== null);
}

export async function readGmailMessage(
  accessToken: string,
  messageId: string
): Promise<GmailMessageItem> {
  const res = await fetch(
    `${GMAIL_API_BASE}/messages/${encodeURIComponent(messageId)}?format=full`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Gmail read error (${res.status}): ${redactSecrets(errText).slice(0, 200)}`);
  }

  const msg = (await res.json().catch(() => ({}))) as {
    id?: string;
    threadId?: string;
    snippet?: string;
    payload?: GmailPart & { headers?: Array<{ name: string; value: string }> };
  };

  const subject = getHeader(msg.payload?.headers, 'Subject') || '(No subject)';
  const body = extractGmailBody(msg.payload) || msg.snippet || '';
  const scan = detectPromptInjection(`${subject}\n${body}`);

  return {
    id: msg.id ?? messageId,
    threadId: msg.threadId ?? '',
    from: getHeader(msg.payload?.headers, 'From') || 'Unknown sender',
    to: getHeader(msg.payload?.headers, 'To'),
    subject,
    date: getHeader(msg.payload?.headers, 'Date'),
    snippet: msg.snippet ?? '',
    body,
    injectionFlagged: scan.flagged,
    injectionMatches: scan.matches,
  };
}

export async function createGmailDraft(
  accessToken: string,
  params: { to: string; subject: string; body: string }
): Promise<{ draftId: string; url: string }> {
  const raw = buildRfc2822Raw(params.to, params.subject, params.body);
  const res = await fetch(`${GMAIL_API_BASE}/drafts`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ message: { raw } }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Gmail draft error (${res.status}): ${redactSecrets(errText).slice(0, 200)}`);
  }

  const data = (await res.json().catch(() => ({}))) as { id?: string };
  return {
    draftId: data.id ?? 'created',
    url: 'https://mail.google.com/mail/u/0/#drafts',
  };
}

export async function sendGmailMessage(
  accessToken: string,
  params: { to: string; subject: string; body: string }
): Promise<{ messageId: string; url: string }> {
  const raw = buildRfc2822Raw(params.to, params.subject, params.body);
  const res = await fetch(`${GMAIL_API_BASE}/messages/send`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ raw }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Gmail send error (${res.status}): ${redactSecrets(errText).slice(0, 200)}`);
  }

  const data = (await res.json().catch(() => ({}))) as { id?: string };
  return {
    messageId: data.id ?? 'sent',
    url: 'https://mail.google.com/mail/u/0/#sent',
  };
}

// ---------------- GOOGLE DRIVE API (drive.file minimal scope) ----------------

function inferMimeType(filename: string, explicitMimeType?: string): string {
  if (explicitMimeType && explicitMimeType.trim()) return explicitMimeType.trim();
  const lower = filename.toLowerCase();
  if (lower.endsWith('.html') || lower.endsWith('.htm')) return 'text/html';
  if (lower.endsWith('.css')) return 'text/css';
  if (lower.endsWith('.js') || lower.endsWith('.mjs')) return 'application/javascript';
  if (lower.endsWith('.json')) return 'application/json';
  if (lower.endsWith('.md')) return 'text/markdown';
  if (lower.endsWith('.py')) return 'text/x-python';
  return 'text/plain';
}

function escapeDriveQueryLiteral(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

export async function ensureIndAgentFolder(accessToken: string): Promise<{
  id: string;
  name: string;
}> {
  const query = `mimeType = 'application/vnd.google-apps.folder' and name = '${escapeDriveQueryLiteral(
    IND_AGENT_DRIVE_FOLDER
  )}' and trashed = false`;
  const searchParams = new URLSearchParams({
    q: query,
    fields: 'files(id, name)',
    pageSize: '5',
  });

  const searchRes = await fetch(`${DRIVE_API_BASE}/files?${searchParams.toString()}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!searchRes.ok) {
    const errText = await searchRes.text();
    throw new Error(
      `Google Drive folder lookup error (${searchRes.status}): ${redactSecrets(errText).slice(0, 200)}`
    );
  }

  const searchJson = (await searchRes.json().catch(() => ({}))) as {
    files?: Array<{ id?: string; name?: string }>;
  };
  const existing = Array.isArray(searchJson?.files) ? searchJson.files[0] : undefined;
  if (existing?.id) {
    return { id: existing.id, name: existing.name || IND_AGENT_DRIVE_FOLDER };
  }

  const createRes = await fetch(`${DRIVE_API_BASE}/files?fields=id,name`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: IND_AGENT_DRIVE_FOLDER,
      mimeType: 'application/vnd.google-apps.folder',
    }),
  });

  if (!createRes.ok) {
    const errText = await createRes.text();
    throw new Error(
      `Google Drive folder creation error (${createRes.status}): ${redactSecrets(errText).slice(0, 200)}`
    );
  }

  const created = (await createRes.json().catch(() => ({}))) as { id?: string; name?: string };
  if (!created?.id) {
    throw new Error('Google Drive did not return a folder ID for "IND AGENT".');
  }
  return { id: created.id, name: created.name || IND_AGENT_DRIVE_FOLDER };
}

export async function listDriveFiles(
  accessToken: string,
  searchQuery = '',
  limit = 20
): Promise<DriveFileItem[]> {
  const clampedLimit = Math.max(1, Math.min(50, Number(limit) || 20));
  const clauses = ["trashed = false", "mimeType != 'application/vnd.google-apps.folder'"];
  if (searchQuery.trim()) {
    clauses.push(`name contains '${escapeDriveQueryLiteral(searchQuery.trim())}'`);
  }

  const params = new URLSearchParams({
    q: clauses.join(' and '),
    fields: 'files(id, name, mimeType, modifiedTime, size, webViewLink)',
    orderBy: 'modifiedTime desc',
    pageSize: String(clampedLimit),
  });

  const res = await fetch(`${DRIVE_API_BASE}/files?${params.toString()}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Google Drive list error (${res.status}): ${redactSecrets(errText).slice(0, 200)}`);
  }

  const json = (await res.json().catch(() => ({}))) as {
    files?: Array<{
      id?: string;
      name?: string;
      mimeType?: string;
      modifiedTime?: string;
      size?: string;
      webViewLink?: string;
    }>;
  };

  const rawFiles = Array.isArray(json?.files) ? json.files : [];
  return rawFiles
    .filter((f): f is { id: string; name?: string; mimeType?: string; modifiedTime?: string; size?: string; webViewLink?: string } =>
      Boolean(f && typeof f.id === 'string')
    )
    .map((f) => ({
      id: f.id,
      name: f.name || 'Untitled file',
      mimeType: f.mimeType || 'text/plain',
      modifiedTime: f.modifiedTime,
      size: f.size,
      webViewLink: f.webViewLink,
    }));
}

export async function readDriveFile(
  accessToken: string,
  fileId: string
): Promise<DriveFileItem> {
  const cleanId = fileId.trim();
  const metaRes = await fetch(
    `${DRIVE_API_BASE}/files/${encodeURIComponent(cleanId)}?fields=id,name,mimeType,modifiedTime,size,webViewLink`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );

  if (!metaRes.ok) {
    const errText = await metaRes.text();
    throw new Error(
      `Google Drive metadata error (${metaRes.status}): ${redactSecrets(errText).slice(0, 200)}`
    );
  }

  const meta = (await metaRes.json().catch(() => ({}))) as {
    id?: string;
    name?: string;
    mimeType?: string;
    modifiedTime?: string;
    size?: string;
    webViewLink?: string;
  };

  const mimeType = meta.mimeType || 'text/plain';
  const contentUrl =
    mimeType === 'application/vnd.google-apps.document'
      ? `${DRIVE_API_BASE}/files/${encodeURIComponent(cleanId)}/export?mimeType=text/plain`
      : `${DRIVE_API_BASE}/files/${encodeURIComponent(cleanId)}?alt=media`;

  const contentRes = await fetch(contentUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!contentRes.ok) {
    const errText = await contentRes.text();
    throw new Error(
      `Google Drive read error (${contentRes.status}): ${redactSecrets(errText).slice(0, 200)}`
    );
  }

  const content = (await contentRes.text()).slice(0, 60000);
  const scan = detectPromptInjection(content);

  return {
    id: meta.id ?? cleanId,
    name: meta.name || 'Untitled file',
    mimeType,
    modifiedTime: meta.modifiedTime,
    size: meta.size,
    webViewLink: meta.webViewLink,
    content,
    injectionFlagged: scan.flagged,
    injectionMatches: scan.matches,
  };
}

export async function saveDriveFile(
  accessToken: string,
  params: { name: string; content: string; mimeType?: string }
): Promise<{ id: string; name: string; webViewLink?: string }> {
  const folder = await ensureIndAgentFolder(accessToken);
  const safeName = params.name.trim() || 'ind-agent-file.txt';
  const mimeType = inferMimeType(safeName, params.mimeType);

  const boundary = `ind_agent_${crypto.randomBytes(8).toString('hex')}`;
  const metadata = JSON.stringify({
    name: safeName,
    mimeType,
    parents: [folder.id],
  });

  const multipartBody = [
    `--${boundary}`,
    'Content-Type: application/json; charset=UTF-8',
    '',
    metadata,
    `--${boundary}`,
    `Content-Type: ${mimeType}; charset=UTF-8`,
    '',
    params.content,
    `--${boundary}--`,
  ].join('\r\n');

  const res = await fetch(
    `${DRIVE_UPLOAD_BASE}/files?uploadType=multipart&fields=id,name,webViewLink`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': `multipart/related; boundary=${boundary}`,
      },
      body: multipartBody,
    }
  );

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Google Drive save error (${res.status}): ${redactSecrets(errText).slice(0, 200)}`);
  }

  const data = (await res.json().catch(() => ({}))) as {
    id?: string;
    name?: string;
    webViewLink?: string;
  };
  return {
    id: data.id ?? 'saved',
    name: data.name ?? safeName,
    webViewLink: data.webViewLink ?? (data.id ? `https://drive.google.com/file/d/${data.id}/view` : undefined),
  };
}

export async function updateDriveFile(
  accessToken: string,
  params: { fileId: string; content: string; name?: string; mimeType?: string }
): Promise<{ id: string; name: string; webViewLink?: string }> {
  const cleanId = params.fileId.trim();
  const mimeType = inferMimeType(params.name || 'file.txt', params.mimeType);

  const boundary = `ind_agent_upd_${crypto.randomBytes(8).toString('hex')}`;
  const metadataObj: Record<string, string> = {};
  if (params.name && params.name.trim()) {
    metadataObj.name = params.name.trim();
  }

  const multipartBody = [
    `--${boundary}`,
    'Content-Type: application/json; charset=UTF-8',
    '',
    JSON.stringify(metadataObj),
    `--${boundary}`,
    `Content-Type: ${mimeType}; charset=UTF-8`,
    '',
    params.content,
    `--${boundary}--`,
  ].join('\r\n');

  const res = await fetch(
    `${DRIVE_UPLOAD_BASE}/files/${encodeURIComponent(cleanId)}?uploadType=multipart&fields=id,name,webViewLink`,
    {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': `multipart/related; boundary=${boundary}`,
      },
      body: multipartBody,
    }
  );

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(
      `Google Drive update error (${res.status}): ${redactSecrets(errText).slice(0, 200)}`
    );
  }

  const data = (await res.json().catch(() => ({}))) as {
    id?: string;
    name?: string;
    webViewLink?: string;
  };
  return {
    id: data.id ?? cleanId,
    name: data.name ?? params.name ?? 'Updated file',
    webViewLink: data.webViewLink ?? `https://drive.google.com/file/d/${cleanId}/view`,
  };
}

export async function trashDriveFile(
  accessToken: string,
  fileId: string
): Promise<{ id: string; name: string }> {
  const cleanId = fileId.trim();
  const res = await fetch(`${DRIVE_API_BASE}/files/${encodeURIComponent(cleanId)}?fields=id,name`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ trashed: true }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(
      `Google Drive trash error (${res.status}): ${redactSecrets(errText).slice(0, 200)}`
    );
  }

  const data = (await res.json().catch(() => ({}))) as { id?: string; name?: string };
  return {
    id: data.id ?? cleanId,
    name: data.name ?? cleanId,
  };
}
