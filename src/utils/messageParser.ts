import type { GeneratedProjectFile } from '../types/agent';

export type MessageSegment =
  | {
      kind: 'prose';
      text: string;
    }
  | {
      kind: 'code';
      language: string;
      filename?: string;
      code: string;
      isSingleFileHtml: boolean;
    }
  | {
      kind: 'draft';
      to: string;
      subject: string;
      language: string;
      body: string;
      raw: string;
    }
  | {
      kind: 'prompt';
      title: string;
      text: string;
    }
  | {
      kind: 'streaming_artifact';
      language: string;
      filename?: string;
      title: string;
      lineCount: number;
      partialCode: string;
    };

function parseDraftContent(rawBody: string): {
  to: string;
  subject: string;
  language: string;
  body: string;
} {
  const lines = rawBody.split('\n');
  let to = '';
  let subject = '';
  let language = '';
  const bodyLines: string[] = [];
  let inHeaders = true;

  for (const line of lines) {
    if (inHeaders) {
      const trimmed = line.trim();
      if (!trimmed) {
        if (to || subject || language) {
          inHeaders = false;
        }
        continue;
      }
      const toMatch = trimmed.match(/^To:\s*(.+)$/i);
      const subjectMatch = trimmed.match(/^Subject:\s*(.+)$/i);
      const langMatch = trimmed.match(/^Language:\s*(.+)$/i);

      if (toMatch) {
        to = toMatch[1].trim();
        continue;
      }
      if (subjectMatch) {
        subject = subjectMatch[1].trim();
        continue;
      }
      if (langMatch) {
        language = langMatch[1].trim();
        continue;
      }
      inHeaders = false;
      bodyLines.push(line);
    } else {
      bodyLines.push(line);
    }
  }

  return {
    to,
    subject,
    language,
    body: bodyLines.join('\n').trim(),
  };
}

function isHtmlSingleFile(language: string, code: string): boolean {
  const lang = language.toLowerCase();
  if (lang === 'html' || lang === 'htm') {
    return /<!doctype\s+html|<html[\s>]|<body[\s>]/i.test(code);
  }
  if (lang === 'svg') {
    return /<svg[\s>]/i.test(code);
  }
  return false;
}

export function extractHtmlTitle(html: string): string | null {
  if (!html || typeof html !== 'string') return null;
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!match) return null;
  const cleaned = match[1].replace(/\s+/g, ' ').trim();
  return cleaned ? cleaned.slice(0, 80) : null;
}

function parseFenceHeader(rawHeader: string): { language: string; filename?: string } {
  const trimmed = rawHeader.trim();
  if (!trimmed) return { language: 'text' };

  // Supports ```tsx:src/App.tsx OR ```prompt:Midjourney Cinematic Portrait OR ```html index.html
  const colonIdx = trimmed.indexOf(':');
  if (colonIdx > 0) {
    const language = trimmed.slice(0, colonIdx).trim() || 'text';
    const filename = trimmed.slice(colonIdx + 1).trim();
    return { language, filename: filename || undefined };
  }

  const parts = trimmed.split(/\s+/);
  const language = parts[0] || 'text';
  if (parts.length > 1) {
    const rest = parts.slice(1).join(' ').replace(/^file(name)?=/i, '').trim();
    if (
      language.toLowerCase() === 'prompt' ||
      language.toLowerCase() === 'system-prompt' ||
      language.toLowerCase() === 'prompt-template'
    ) {
      return { language, filename: rest || undefined };
    }
    if (rest && /[./]/.test(rest)) {
      return { language, filename: rest };
    }
  }
  return { language };
}

function isPromptLanguage(language: string): boolean {
  const l = language.trim().toLowerCase();
  return l === 'prompt' || l === 'system-prompt' || l === 'prompt-template';
}

function isPromptFilename(filename?: string): boolean {
  if (!filename) return false;
  return /(^|[-_/ ])prompt([-_. ]|$)/i.test(filename);
}

function proseIntroducesPrompt(prose?: string): string | null {
  if (!prose) return null;
  const lines = prose
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  const lastLine = lines[lines.length - 1] ?? '';
  if (!lastLine) return null;

  // Match headings or lead-ins like "### Copyable Prompt", "**Image Prompt:**", "Here is your prompt:"
  if (
    /\b(copyable\s+prompt|engineered\s+prompt|system\s+prompt|image\s+prompt|video\s+prompt|ai\s+prompt|ready[- ]to[- ]use\s+prompt|your\s+prompt|here(?:'s| is)\s+(?:the|your|a)\s+(?:refined\s+|optimized\s+|copy[- ]ready\s+|ready[- ]to[- ]use\s+)?prompt|prompt\s*:)\b/i.test(
      lastLine
    )
  ) {
    const cleaned = lastLine
      .replace(/^#{1,4}\s*/, '')
      .replace(/[*_`]/g, '')
      .replace(/:\s*$/, '')
      .trim();
    if (cleaned.length >= 4 && cleaned.length <= 70) {
      return cleaned;
    }
    return 'Copyable Prompt';
  }
  return null;
}

function formatPromptTitle(rawTitle?: string): string {
  if (!rawTitle || !rawTitle.trim()) return 'Ready-to-Copy Prompt';
  const cleaned = rawTitle
    .replace(/\.(md|txt)$/i, '')
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return 'Ready-to-Copy Prompt';
  // Capitalize first letter if all lowercase
  if (cleaned === cleaned.toLowerCase()) {
    return cleaned.replace(/\b\w/g, (ch) => ch.toUpperCase());
  }
  return cleaned;
}

/**
 * Safely parses IND AGENT output into structured prose, copyable prompt cards,
 * fenced code blocks (with optional multi-file paths), DRAFT email blocks,
 * and in-progress streaming HTML/SVG artifacts without raw HTML injection.
 */
export function parseAgentMessage(content: string): MessageSegment[] {
  if (!content || typeof content !== 'string') return [];

  const segments: MessageSegment[] = [];
  const blockRegex =
    /```([^\r\n`]*)\r?\n([\s\S]*?)```|---\s*DRAFT\s*---\r?\n([\s\S]*?)---\s*END\s*DRAFT\s*---|---\s*PROMPT(?:\s*:\s*([^\r\n-]+))?\s*---\r?\n([\s\S]*?)---\s*END\s*PROMPT\s*---/gi;

  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = blockRegex.exec(content)) !== null) {
    let trailingFilenameFromProse: string | undefined;
    let precedingProseText = '';

    if (match.index > lastIndex) {
      const prose = content.slice(lastIndex, match.index).trim();
      if (prose) {
        precedingProseText = prose;
        const fileHeading = prose.match(
          /(?:^|\n)(?:#{1,4}\s*)?(?:\d+\.\s*)?(?:(?:File|Path)\s*:\s*)?[*_`]*([A-Za-z0-9_./-]+\.[A-Za-z0-9]{1,8})[*_`]*\s*$/i
        );
        if (fileHeading) {
          trailingFilenameFromProse = fileHeading[1].trim();
        }
        segments.push({ kind: 'prose', text: prose });
      }
    }

    if (match[2] !== undefined) {
      const { language, filename } = parseFenceHeader(match[1] || 'text');
      const body = match[2].replace(/\n$/, '');
      const langLower = language.toLowerCase();

      if (langLower === 'draft') {
        const parsed = parseDraftContent(body);
        segments.push({
          kind: 'draft',
          to: parsed.to,
          subject: parsed.subject,
          language: parsed.language,
          body: parsed.body || body.trim(),
          raw: body,
        });
      } else if (
        isPromptLanguage(langLower) ||
        ((langLower === 'text' || langLower === 'txt' || langLower === 'markdown' || langLower === 'md' || langLower === 'plain') &&
          (isPromptFilename(filename || trailingFilenameFromProse) ||
            Boolean(proseIntroducesPrompt(precedingProseText))))
      ) {
        const inferredTitle =
          filename ||
          trailingFilenameFromProse ||
          proseIntroducesPrompt(precedingProseText) ||
          'Ready-to-Copy Prompt';
        segments.push({
          kind: 'prompt',
          title: formatPromptTitle(inferredTitle),
          text: body.trim(),
        });
      } else {
        segments.push({
          kind: 'code',
          language: language || 'text',
          filename: filename || trailingFilenameFromProse,
          code: body,
          isSingleFileHtml: isHtmlSingleFile(language, body),
        });
      }
    } else if (match[3] !== undefined) {
      const raw = match[3].trim();
      const parsed = parseDraftContent(raw);
      segments.push({
        kind: 'draft',
        to: parsed.to,
        subject: parsed.subject,
        language: parsed.language,
        body: parsed.body || raw,
        raw,
      });
    } else if (match[5] !== undefined) {
      segments.push({
        kind: 'prompt',
        title: formatPromptTitle(match[4]),
        text: match[5].trim(),
      });
    }

    lastIndex = blockRegex.lastIndex;
  }

  if (lastIndex < content.length) {
    const trailing = content.slice(lastIndex);
    // Detect an in-progress (unclosed) fenced HTML/SVG/prompt block during live streaming
    const openFenceMatch = trailing.match(/```([^\r\n`]*)\r?\n([\s\S]*)$/);
    if (openFenceMatch && openFenceMatch.index !== undefined) {
      const beforeOpen = trailing.slice(0, openFenceMatch.index).trim();
      if (beforeOpen) {
        segments.push({ kind: 'prose', text: beforeOpen });
      }
      const { language, filename } = parseFenceHeader(openFenceMatch[1] || 'text');
      const langLower = language.toLowerCase();
      const partialCode = openFenceMatch[2] ?? '';

      if (
        langLower === 'html' ||
        langLower === 'htm' ||
        langLower === 'svg' ||
        (filename && /\.(html?|svg)$/i.test(filename))
      ) {
        const htmlTitle = extractHtmlTitle(partialCode);
        segments.push({
          kind: 'streaming_artifact',
          language: language || 'html',
          filename: filename || 'index.html',
          title: htmlTitle || filename || 'Interactive Website Artifact',
          lineCount: partialCode ? partialCode.split('\n').length : 0,
          partialCode,
        });
      } else if (isPromptLanguage(langLower)) {
        segments.push({
          kind: 'prompt',
          title: formatPromptTitle(filename),
          text: partialCode.trim(),
        });
      } else {
        const trimmedTrailing = trailing.trim();
        if (trimmedTrailing) {
          segments.push({ kind: 'prose', text: trimmedTrailing });
        }
      }
    } else {
      const trimmedTrailing = trailing.trim();
      if (trimmedTrailing) {
        segments.push({ kind: 'prose', text: trimmedTrailing });
      }
    }
  }

  return segments;
}

export function getSuggestedFilename(
  language: string,
  index: number,
  explicitFilename?: string
): string {
  if (explicitFilename && explicitFilename.trim()) {
    return explicitFilename.trim();
  }
  const lang = (language || 'text').toLowerCase();
  if (lang === 'html' || lang === 'htm') return `ind-tool-${index + 1}.html`;
  if (lang === 'svg') return `graphic-${index + 1}.svg`;
  if (lang === 'lua' || lang === 'luau') return `roblox-script-${index + 1}.luau`;
  if (lang === 'python' || lang === 'py') return `script-${index + 1}.py`;
  if (lang === 'js' || lang === 'javascript') return `script-${index + 1}.js`;
  if (lang === 'jsx') return `component-${index + 1}.jsx`;
  if (lang === 'ts' || lang === 'typescript') return `script-${index + 1}.ts`;
  if (lang === 'tsx') return `component-${index + 1}.tsx`;
  if (lang === 'css') return `styles-${index + 1}.css`;
  if (lang === 'json') return `config-${index + 1}.json`;
  return `snippet-${index + 1}.txt`;
}

export function extractProjectFiles(content: string): GeneratedProjectFile[] {
  const segments = parseAgentMessage(content);
  const files: GeneratedProjectFile[] = [];
  let codeIdx = 0;

  for (const seg of segments) {
    if (seg.kind === 'code') {
      files.push({
        path: getSuggestedFilename(seg.language, codeIdx, seg.filename),
        language: seg.language,
        content: seg.code,
      });
      codeIdx += 1;
    }
  }

  return files;
}

export interface DetectedWebsiteArtifact {
  title: string;
  files: GeneratedProjectFile[];
  activePath: string;
  primaryHtml: string;
  totalLines: number;
}

/**
 * Detects whether a completed AI response contains a previewable Claude-style Website Artifact
 * (single-file HTML/SVG or multi-file web project with an HTML entrypoint).
 */
export function detectWebsiteArtifact(content: string): DetectedWebsiteArtifact | null {
  const files = extractProjectFiles(content);
  if (files.length === 0) return null;

  const htmlFile = files.find((f) => {
    const lang = f.language.toLowerCase();
    const path = f.path.toLowerCase();
    if (lang === 'html' || lang === 'htm' || path.endsWith('.html') || path.endsWith('.htm')) {
      return /<!doctype\s+html|<html[\s>]|<body[\s>]/i.test(f.content);
    }
    if (lang === 'svg' || path.endsWith('.svg')) {
      return /<svg[\s>]/i.test(f.content);
    }
    return false;
  });

  if (!htmlFile) return null;

  const extractedTitle = extractHtmlTitle(htmlFile.content);
  const fallbackTitle =
    files.length > 1
      ? 'Full-Stack Web Artifact'
      : htmlFile.language.toLowerCase() === 'svg'
        ? 'Interactive SVG Artifact'
        : 'Interactive Website Artifact';

  const totalLines = files.reduce((sum, f) => sum + f.content.split('\n').length, 0);

  return {
    title: extractedTitle || fallbackTitle,
    files,
    activePath: htmlFile.path,
    primaryHtml: htmlFile.content,
    totalLines,
  };
}

/**
 * Inlines sibling CSS/JS files generated in the same multi-file response into an HTML entrypoint
 * so "Preview Website" renders styled and interactive websites even if CSS/JS were emitted separately.
 */
export function buildPreviewableHtml(
  projectFiles: GeneratedProjectFile[],
  primaryHtml: string
): string {
  if (!primaryHtml) return '';
  if (!Array.isArray(projectFiles) || projectFiles.length <= 1) return primaryHtml;

  let result = primaryHtml;

  for (const file of projectFiles) {
    const cleanPath = file.path.replace(/^\.?\//, '');
    const basename = cleanPath.split('/').pop() || cleanPath;
    const lang = file.language.toLowerCase();

    if (lang === 'css' || basename.endsWith('.css')) {
      const escaped = basename.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const linkRe = new RegExp(
        `<link[^>]+href=["'](?:\\.?\\/)?(?:[^"']*\\/)?${escaped}["'][^>]*>`,
        'gi'
      );
      if (linkRe.test(result)) {
        result = result.replace(linkRe, `<style>\n${file.content}\n</style>`);
      }
    } else if (
      (lang === 'js' || lang === 'javascript' || basename.endsWith('.js')) &&
      !/server\.js$/i.test(basename) &&
      !/index\.mjs$/i.test(basename)
    ) {
      const escaped = basename.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const scriptRe = new RegExp(
        `<script[^>]+src=["'](?:\\.?\\/)?(?:[^"']*\\/)?${escaped}["'][^>]*>\\s*<\\/script>`,
        'gi'
      );
      if (scriptRe.test(result)) {
        result = result.replace(scriptRe, `<script>\n${file.content}\n</script>`);
      }
    }
  }

  return result;
}
