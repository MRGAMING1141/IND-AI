import { useMemo, useState } from 'react';
import {
  Archive,
  Check,
  ChevronDown,
  ChevronUp,
  Code2,
  Copy,
  CornerDownLeft,
  Download,
  ExternalLink,
  Eye,
  FolderUp,
  Globe,
  Hash,
  Loader2,
  Lock,
  MailPlus,
  PanelRightOpen,
  Sparkles,
  WrapText,
} from 'lucide-react';
import { copyTextToClipboard } from '../utils/clipboard';
import {
  buildPreviewableHtml,
  detectWebsiteArtifact,
  extractProjectFiles,
  getSuggestedFilename,
  parseAgentMessage,
} from '../utils/messageParser';
import {
  getDisplayLanguageLabel,
  tokenizeCodeLines,
} from '../utils/syntaxHighlight';
import { sanitizeExternalUrl } from '../utils/safetyEngine';
import { buildZipBytes } from '../utils/zipBuilder';
import type { ReactNode } from 'react';
import type { GeneratedProjectFile, UserPlan } from '../types/agent';

function renderInlineProse(line: string): ReactNode[] {
  // Matches **bold**, `inline code`, [label](url), or *italic*
  const tokens = line.split(/(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\)|\*[^*\s][^*]*\*)/g);
  return tokens.map((token, idx) => {
    if (!token) return null;

    if (token.startsWith('**') && token.endsWith('**') && token.length > 4) {
      return (
        <strong key={idx} className="font-semibold text-[#1F1F1F] dark:text-[#F1F3F4]">
          {token.slice(2, -2)}
        </strong>
      );
    }

    if (token.startsWith('`') && token.endsWith('`') && token.length > 2) {
      return (
        <code
          key={idx}
          className="rounded-md bg-[#F0F4F9] dark:bg-[#282A2C] px-1.5 py-0.5 font-mono text-[13px] text-[#1F1F1F] dark:text-[#E3E3E3]"
        >
          {token.slice(1, -1)}
        </code>
      );
    }

    if (token.startsWith('[') && token.includes('](') && token.endsWith(')')) {
      const linkMatch = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      if (linkMatch) {
        const safeUrl = sanitizeExternalUrl(linkMatch[2]);
        if (safeUrl) {
          return (
            <a
              key={idx}
              href={safeUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-0.5 font-medium text-[#1A73E8] dark:text-[#8AB4F8] hover:underline"
            >
              <span>{linkMatch[1]}</span>
              <ExternalLink className="h-3 w-3 shrink-0" aria-hidden="true" />
            </a>
          );
        }
        return <span key={idx}>{linkMatch[1]}</span>;
      }
    }

    if (
      token.startsWith('*') &&
      token.endsWith('*') &&
      token.length > 2 &&
      !token.startsWith('**')
    ) {
      return (
        <em key={idx} className="italic text-[#3C4043] dark:text-[#C4C7C5]">
          {token.slice(1, -1)}
        </em>
      );
    }

    return token;
  });
}

function renderPromptTextWithPlaceholders(text: string): ReactNode[] {
  // Highlight [PLACEHOLDER] or {{variable}} tokens gently so users spot customizable slots
  const parts = text.split(/(\[[A-Z0-9_ /:-]{2,48}\]|\{\{[^}]{1,48}\}\})/g);
  return parts.map((part, idx) => {
    if (!part) return null;
    if (
      (part.startsWith('[') && part.endsWith(']')) ||
      (part.startsWith('{{') && part.endsWith('}}'))
    ) {
      return (
        <span
          key={idx}
          className="rounded-md bg-[#E8F0FE] dark:bg-[#004A77]/60 px-1 py-0.5 font-mono text-[12.5px] font-medium text-[#1557B0] dark:text-[#A8C7FA]"
        >
          {part}
        </span>
      );
    }
    return part;
  });
}

function isMarkdownTableRow(line: string): boolean {
  const t = line.trim();
  return t.startsWith('|') && t.endsWith('|') && t.split('|').length >= 3;
}

function isMarkdownTableSeparator(line: string): boolean {
  const t = line.trim();
  return /^\|(?:\s*:?-{2,}:?\s*\|)+$/.test(t);
}

function parseTableCells(line: string): string[] {
  return line
    .trim()
    .slice(1, -1)
    .split('|')
    .map((cell) => cell.trim());
}

function ProseBlock({ text }: { text: string }) {
  const lines = text.split('\n');
  const elements: ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const rawLine = lines[i];
    const trimmed = rawLine.trim();

    if (!trimmed) {
      i += 1;
      continue;
    }

    // Horizontal rule
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      elements.push(
        <hr key={`hr-${i}`} className="my-3 border-t border-[#E1E5EA] dark:border-[#2E3033]" />
      );
      i += 1;
      continue;
    }

    // Markdown Table
    if (
      isMarkdownTableRow(rawLine) &&
      i + 1 < lines.length &&
      isMarkdownTableSeparator(lines[i + 1])
    ) {
      const headerCells = parseTableCells(rawLine);
      i += 2;
      const bodyRows: string[][] = [];
      while (i < lines.length && isMarkdownTableRow(lines[i])) {
        bodyRows.push(parseTableCells(lines[i]));
        i += 1;
      }
      elements.push(
        <div
          key={`tbl-${i}`}
          className="my-2 overflow-x-auto rounded-xl border border-[#E1E5EA] dark:border-[#333537]"
        >
          <table className="w-full text-left text-[13px]">
            <thead className="border-b border-[#E1E5EA] dark:border-[#333537] bg-[#F8FAFD] dark:bg-[#1E1F20]">
              <tr>
                {headerCells.map((cell, cIdx) => (
                  <th
                    key={cIdx}
                    className="px-3.5 py-2 font-semibold text-[#1F1F1F] dark:text-[#F1F3F4]"
                  >
                    {renderInlineProse(cell)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E8EDF4] dark:divide-[#282A2C] bg-white dark:bg-[#131314]">
              {bodyRows.map((row, rIdx) => (
                <tr key={rIdx} className="hover:bg-[#F8FAFD] dark:hover:bg-[#1E1F20]/60">
                  {row.map((cell, cIdx) => (
                    <td key={cIdx} className="px-3.5 py-2 text-[#444746] dark:text-[#C4C7C5]">
                      {renderInlineProse(cell)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      continue;
    }

    // Headings
    const h3Match = trimmed.match(/^###\s+(.+)$/);
    if (h3Match) {
      elements.push(
        <h3
          key={`h3-${i}`}
          className="pt-2.5 text-[15px] font-semibold tracking-tight text-[#1F1F1F] dark:text-[#F1F3F4]"
        >
          {renderInlineProse(h3Match[1])}
        </h3>
      );
      i += 1;
      continue;
    }

    const h2Match = trimmed.match(/^##\s+(.+)$/);
    if (h2Match) {
      elements.push(
        <h2
          key={`h2-${i}`}
          className="pt-3 text-[17px] font-semibold tracking-tight text-[#1F1F1F] dark:text-[#F1F3F4]"
        >
          {renderInlineProse(h2Match[1])}
        </h2>
      );
      i += 1;
      continue;
    }

    const h1Match = trimmed.match(/^#\s+(.+)$/);
    if (h1Match) {
      elements.push(
        <h2
          key={`h1-${i}`}
          className="pt-3 text-[19px] font-semibold tracking-tight text-[#1F1F1F] dark:text-[#F1F3F4]"
        >
          {renderInlineProse(h1Match[1])}
        </h2>
      );
      i += 1;
      continue;
    }

    // Blockquote
    if (trimmed.startsWith('> ')) {
      const quoteLines: string[] = [];
      const startIdx = i;
      while (i < lines.length && lines[i].trim().startsWith('> ')) {
        quoteLines.push(lines[i].trim().slice(2));
        i += 1;
      }
      elements.push(
        <blockquote
          key={`bq-${startIdx}`}
          className="my-2 rounded-r-xl border-l-2 border-[#1A73E8] dark:border-[#8AB4F8] bg-[#F8FAFD] dark:bg-[#1E1F20]/70 px-4 py-2.5 text-[14px] text-[#444746] dark:text-[#C4C7C5]"
        >
          {quoteLines.map((ql, qIdx) => (
            <p key={qIdx}>{renderInlineProse(ql)}</p>
          ))}
        </blockquote>
      );
      continue;
    }

    // Unordered list
    if (/^[-*•]\s+/.test(trimmed)) {
      const items: string[] = [];
      const startIdx = i;
      while (i < lines.length && /^[-*•]\s+/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^[-*•]\s+/, ''));
        i += 1;
      }
      elements.push(
        <ul
          key={`ul-${startIdx}`}
          className="list-disc space-y-1.5 pl-5 marker:text-[#5F6368] dark:marker:text-[#8E918F]"
        >
          {items.map((item, idx) => (
            <li key={idx} className="leading-[1.65] pl-0.5">
              {renderInlineProse(item)}
            </li>
          ))}
        </ul>
      );
      continue;
    }

    // Ordered list
    if (/^\d+\.\s+/.test(trimmed)) {
      const items: string[] = [];
      const startIdx = i;
      while (i < lines.length && /^\d+\.\s+/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^\d+\.\s+/, ''));
        i += 1;
      }
      elements.push(
        <ol
          key={`ol-${startIdx}`}
          className="list-decimal space-y-1.5 pl-5 marker:font-medium marker:text-[#5F6368] dark:marker:text-[#9AA0A6]"
        >
          {items.map((item, idx) => (
            <li key={idx} className="leading-[1.65] pl-0.5">
              {renderInlineProse(item)}
            </li>
          ))}
        </ol>
      );
      continue;
    }

    // Standard paragraph
    elements.push(
      <p key={`p-${i}`} className="whitespace-pre-wrap break-words leading-[1.7]">
        {renderInlineProse(rawLine)}
      </p>
    );
    i += 1;
  }

  return <div className="space-y-2">{elements}</div>;
}

interface PromptBlockCardProps {
  title: string;
  text: string;
  copied: boolean;
  onCopy: () => void;
  onUsePrompt?: (text: string) => void;
}

function PromptBlockCard({ title, text, copied, onCopy, onUsePrompt }: PromptBlockCardProps) {
  const wordCount = text ? text.split(/\s+/).filter(Boolean).length : 0;

  return (
    <div
      className="rounded-2xl border border-[#D2E3FC] dark:border-[#333537] bg-[#F8FAFD] dark:bg-[#1E1F20] overflow-hidden shadow-xs"
      role="region"
      aria-label={`Copyable prompt: ${title}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#E1E9F6] dark:border-[#2E3033] bg-white/80 dark:bg-[#252628] px-4 py-2.5">
        <div className="flex items-center gap-2 min-w-0">
          <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-[#E8F0FE] dark:bg-[#004A77]/70 text-[#1A73E8] dark:text-[#8AB4F8]">
            <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="truncate text-xs font-semibold text-[#1F1F1F] dark:text-[#F1F3F4]">
                {title}
              </span>
              <span className="shrink-0 font-mono text-[11px] text-[#5F6368] dark:text-[#9AA0A6] tabular-nums">
                {wordCount} {wordCount === 1 ? 'word' : 'words'}
              </span>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5 shrink-0">
          {onUsePrompt && (
            <button
              type="button"
              onClick={() => onUsePrompt(text)}
              className="inline-flex items-center gap-1.5 rounded-full border border-[#DDE3EA] dark:border-[#3C4043] bg-white dark:bg-[#282A2C] px-3 py-1 text-xs font-medium text-[#444746] dark:text-[#E3E3E3] hover:bg-[#F0F4F9] dark:hover:bg-[#333537] transition-colors whitespace-nowrap"
            >
              <CornerDownLeft className="h-3.5 w-3.5" aria-hidden="true" />
              Use in Chat
            </button>
          )}
          <button
            type="button"
            onClick={onCopy}
            className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-1 text-xs font-medium transition-colors whitespace-nowrap ${
              copied
                ? 'bg-[#E6F4EA] dark:bg-[#173322] text-[#137333] dark:text-[#81C995]'
                : 'bg-[#1A73E8] text-white hover:bg-[#1557B0]'
            }`}
          >
            {copied ? (
              <>
                <Check className="h-3.5 w-3.5" aria-hidden="true" />
                Copied Prompt
              </>
            ) : (
              <>
                <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                Copy Prompt
              </>
            )}
          </button>
        </div>
      </div>

      <div className="px-4 py-3.5">
        <div className="whitespace-pre-wrap break-words text-[14px] leading-[1.68] text-[#1F1F1F] dark:text-[#E3E3E3] select-text">
          {renderPromptTextWithPlaceholders(text)}
        </div>
      </div>
    </div>
  );
}

interface CodeBlockCardProps {
  code: string;
  language: string;
  filename: string;
  isSingleFileHtml: boolean;
  copied: boolean;
  onCopy: () => void;
  onDownload: () => void;
  onPreviewHtml?: () => void;
  onOpenWorkbench?: () => void;
  onQueueSaveToDrive?: () => void;
}

function CodeBlockCard({
  code,
  language,
  filename,
  isSingleFileHtml,
  copied,
  onCopy,
  onDownload,
  onPreviewHtml,
  onOpenWorkbench,
  onQueueSaveToDrive,
}: CodeBlockCardProps) {
  const [showLineNumbers, setShowLineNumbers] = useState(true);
  const [wrapLines, setWrapLines] = useState(false);

  const highlightedLines = useMemo(
    () => tokenizeCodeLines(code, language),
    [code, language]
  );

  const lineCount = highlightedLines.length;
  const displayLang = getDisplayLanguageLabel(language);
  const gutterDigits = Math.max(2, String(lineCount).length);

  return (
    <div className="rounded-2xl border border-[#282A2C] bg-[#131314] text-[#E3E3E3] overflow-hidden shadow-xs">
      {/* Polished Code Header Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#282A2C] bg-[#1E1F20] px-4 py-2.5">
        <div className="flex items-center gap-2 text-xs text-[#C4C7C5] font-mono min-w-0">
          <span className="font-semibold text-[#8AB4F8]">{displayLang}</span>
          <span className="text-[#5F6368]" aria-hidden="true">
            ·
          </span>
          <span className="truncate text-[#E3E3E3]">{filename}</span>
          <span className="text-[#5F6368]" aria-hidden="true">
            ·
          </span>
          <span className="text-[#8E918F] tabular-nums shrink-0">{lineCount} lines</span>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {onOpenWorkbench && (
            <button
              type="button"
              onClick={onOpenWorkbench}
              className="inline-flex items-center gap-1.5 rounded-full bg-[#1A73E8] px-3 py-1 text-xs font-medium text-white hover:bg-[#1557B0] transition-colors whitespace-nowrap shrink-0"
            >
              <PanelRightOpen className="h-3.5 w-3.5" />
              Workbench
            </button>
          )}
          {isSingleFileHtml && onPreviewHtml && (
            <button
              type="button"
              onClick={onPreviewHtml}
              className="inline-flex items-center gap-1.5 rounded-full bg-[#282A2C] px-2.5 py-1 text-xs font-medium text-[#8AB4F8] hover:bg-[#333537] transition-colors whitespace-nowrap shrink-0"
            >
              <Eye className="h-3.5 w-3.5" />
              Full Preview
            </button>
          )}
          <button
            type="button"
            onClick={() => setShowLineNumbers((prev) => !prev)}
            title={showLineNumbers ? 'Hide line numbers' : 'Show line numbers'}
            aria-label={showLineNumbers ? 'Hide line numbers' : 'Show line numbers'}
            aria-pressed={showLineNumbers}
            className={`inline-flex h-7 w-7 items-center justify-center rounded-full transition-colors ${
              showLineNumbers
                ? 'bg-[#333537] text-[#E3E3E3]'
                : 'bg-[#282A2C] text-[#9AA0A6] hover:bg-[#333537] hover:text-[#E3E3E3]'
            }`}
          >
            <Hash className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setWrapLines((prev) => !prev)}
            title={wrapLines ? 'Disable word wrap' : 'Enable word wrap'}
            aria-label={wrapLines ? 'Disable word wrap' : 'Enable word wrap'}
            aria-pressed={wrapLines}
            className={`inline-flex h-7 w-7 items-center justify-center rounded-full transition-colors ${
              wrapLines
                ? 'bg-[#333537] text-[#E3E3E3]'
                : 'bg-[#282A2C] text-[#9AA0A6] hover:bg-[#333537] hover:text-[#E3E3E3]'
            }`}
          >
            <WrapText className="h-3.5 w-3.5" />
          </button>
          {onQueueSaveToDrive && (
            <button
              type="button"
              onClick={onQueueSaveToDrive}
              className="inline-flex items-center gap-1.5 rounded-full bg-[#282A2C] px-2.5 py-1 text-xs font-medium text-[#E3E3E3] hover:bg-[#333537] transition-colors whitespace-nowrap shrink-0"
            >
              <FolderUp className="h-3.5 w-3.5" />
              Save to Drive
            </button>
          )}
          <button
            type="button"
            onClick={onDownload}
            className="inline-flex items-center gap-1.5 rounded-full bg-[#282A2C] px-2.5 py-1 text-xs font-medium text-[#E3E3E3] hover:bg-[#333537] transition-colors whitespace-nowrap shrink-0"
          >
            <Download className="h-3.5 w-3.5" />
            Download
          </button>
          <button
            type="button"
            onClick={onCopy}
            className="inline-flex items-center gap-1.5 rounded-full bg-[#282A2C] px-2.5 py-1 text-xs font-medium text-[#E3E3E3] hover:bg-[#333537] transition-colors whitespace-nowrap shrink-0"
          >
            {copied ? (
              <>
                <Check className="h-3.5 w-3.5 text-[#81C995]" />
                Copied
              </>
            ) : (
              <>
                <Copy className="h-3.5 w-3.5" />
                Copy
              </>
            )}
          </button>
        </div>
      </div>

      {/* Syntax-Highlighted Code Body */}
      <pre
        className={`max-h-[560px] overflow-auto py-3.5 px-3 text-[13px] leading-[1.6] font-mono text-[#E3E3E3] ${
          wrapLines ? 'whitespace-pre-wrap break-words' : 'whitespace-pre'
        }`}
      >
        <code className="block min-w-full">
          {highlightedLines.map((lineSpans, lineIdx) => (
            <div
              key={lineIdx}
              className="flex hover:bg-white/[0.03] rounded-xs px-1"
            >
              {showLineNumbers && (
                <span
                  aria-hidden="true"
                  className="select-none pr-4 text-right font-mono text-[12px] text-[#5F6368] tabular-nums shrink-0"
                  style={{ minWidth: `${gutterDigits + 2}ch` }}
                >
                  {lineIdx + 1}
                </span>
              )}
              <span className="flex-1 min-w-0">
                {lineSpans.length === 0
                  ? '\n'
                  : lineSpans.map((span, sIdx) =>
                      span.tokenType && span.tokenType !== 'plain' ? (
                        <span key={sIdx} className={`tok-${span.tokenType}`}>
                          {span.text}
                        </span>
                      ) : (
                        span.text
                      )
                    )}
              </span>
            </div>
          ))}
        </code>
      </pre>
    </div>
  );
}

interface MessageRendererProps {
  content: string;
  plan?: UserPlan;
  isActiveArtifact?: boolean;
  isStreaming?: boolean;
  onPreviewHtml: (html: string) => void;
  onOpenArtifact?: (payload: {
    title: string;
    files: GeneratedProjectFile[];
    activePath: string;
  }) => void;
  onUsePrompt?: (promptText: string) => void;
  onQueueDraft?: (draft: { to: string; subject: string; body: string; language: string }) => void;
  onQueueSaveToDrive?: (file: { name: string; content: string }) => void;
  onNavigatePlans?: () => void;
}

export function MessageRenderer({
  content,
  plan = 'free',
  isActiveArtifact = false,
  isStreaming = false,
  onPreviewHtml,
  onOpenArtifact,
  onUsePrompt,
  onQueueDraft,
  onQueueSaveToDrive,
  onNavigatePlans,
}: MessageRendererProps) {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [showRawArtifactCode, setShowRawArtifactCode] = useState(false);

  const safeContent = typeof content === 'string' ? content : '';
  const segments = useMemo(() => parseAgentMessage(safeContent), [safeContent]);
  const projectFiles = useMemo(() => extractProjectFiles(safeContent), [safeContent]);
  const detectedWebsiteArtifact = useMemo(() => detectWebsiteArtifact(safeContent), [safeContent]);
  // Never emit a clickable Website Artifact until final verified code is complete
  const websiteArtifact = isStreaming ? null : detectedWebsiteArtifact;

  const handleCopy = async (key: string, text: string) => {
    const ok = await copyTextToClipboard(text);
    if (ok) {
      setCopiedKey(key);
      window.setTimeout(() => setCopiedKey(null), 1800);
    }
  };

  const handleDownload = (code: string, filename: string) => {
    const blob = new Blob([code], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleDownloadZip = () => {
    if (projectFiles.length === 0) return;
    const zipBytes = buildZipBytes(
      projectFiles.map((f) => ({ path: f.path, content: f.content }))
    );
    const buffer = zipBytes.buffer.slice(
      zipBytes.byteOffset,
      zipBytes.byteOffset + zipBytes.byteLength
    ) as ArrayBuffer;
    const blob = new Blob([buffer], { type: 'application/zip' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'ind-agent-project.zip';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const totalCodeLines = projectFiles.reduce(
    (sum, f) => sum + f.content.split('\n').length,
    0
  );

  // Track whether we already rendered the unified Claude-style Website Artifact card or streaming status in this message
  let renderedWebsiteArtifactCard = false;
  let renderedStreamingCodeStatus = false;
  const streamingDraftLines = isStreaming
    ? segments.reduce((sum, seg) => {
        if (seg.kind === 'streaming_artifact') return sum + seg.lineCount;
        if (seg.kind === 'code') return sum + seg.code.split('\n').length;
        return sum;
      }, 0)
    : 0;

  return (
    <div className="space-y-4 text-[15px] leading-[1.68] text-[#1F1F1F] dark:text-[#E3E3E3]">
      {/* Multi-file banner ONLY for finalized non-website code projects */}
      {!isStreaming && !websiteArtifact && projectFiles.length > 1 && (
        <div className="flex flex-wrap items-center justify-between gap-2.5 rounded-2xl border border-[#E1E5EA] dark:border-[#333537] bg-[#F8FAFD] dark:bg-[#1E1F20] px-4 py-3 text-xs">
          <div className="flex flex-wrap items-center gap-2 font-medium text-[#1F1F1F] dark:text-[#E3E3E3]">
            <span className="font-mono tabular-nums">
              Multi-file output · {projectFiles.length} files · {totalCodeLines} lines
            </span>
            <span className="text-[#94A3B8]" aria-hidden="true">
              ·
            </span>
            <span className="font-mono text-[11px] text-[#5F6368] dark:text-[#9AA0A6] truncate max-w-[320px]">
              {projectFiles.map((f) => f.path).join(', ')}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {onOpenArtifact && (
              <button
                type="button"
                onClick={() =>
                  onOpenArtifact({
                    title: 'Project Workbench',
                    files: projectFiles,
                    activePath: projectFiles[0].path,
                  })
                }
                className="inline-flex items-center gap-1.5 rounded-full bg-[#1A73E8] px-3.5 py-1.5 text-xs font-medium text-white hover:bg-[#1557B0] transition-colors whitespace-nowrap shrink-0"
              >
                <PanelRightOpen className="h-3.5 w-3.5" />
                Open in Workbench
              </button>
            )}
            {plan === 'plus' ? (
              <button
                type="button"
                onClick={handleDownloadZip}
                className="inline-flex items-center gap-1.5 rounded-full border border-[#DDE3EA] dark:border-[#3C4043] bg-white dark:bg-[#282A2C] px-3.5 py-1.5 text-xs font-medium text-[#1F1F1F] dark:text-[#E3E3E3] hover:bg-[#F0F4F9] dark:hover:bg-[#333537] transition-colors whitespace-nowrap shrink-0"
              >
                <Archive className="h-3.5 w-3.5" />
                Download Project (.zip)
              </button>
            ) : (
              <button
                type="button"
                onClick={onNavigatePlans}
                className="inline-flex items-center gap-1.5 rounded-full border border-[#DDE3EA] dark:border-[#3C4043] bg-white dark:bg-[#282A2C] px-3.5 py-1.5 text-xs font-medium text-[#444746] dark:text-[#C4C7C5] hover:bg-[#F0F4F9] dark:hover:bg-[#333537] transition-colors whitespace-nowrap shrink-0"
              >
                <Lock className="h-3.5 w-3.5 text-[#5F6368] dark:text-[#9AA0A6]" />
                ZIP Download (Plus)
              </button>
            )}
          </div>
        </div>
      )}

      {segments.map((seg, idx) => {
        if (seg.kind === 'prose') {
          return <ProseBlock key={idx} text={seg.text} />;
        }

        if (seg.kind === 'prompt') {
          const copyId = `prompt-${idx}`;
          return (
            <PromptBlockCard
              key={idx}
              title={seg.title}
              text={seg.text}
              copied={copiedKey === copyId}
              onCopy={() => void handleCopy(copyId, seg.text)}
              onUsePrompt={onUsePrompt}
            />
          );
        }

        if (seg.kind === 'streaming_artifact' || (isStreaming && seg.kind === 'code')) {
          if (renderedStreamingCodeStatus) return null;
          renderedStreamingCodeStatus = true;
          const lineCount =
            streamingDraftLines > 0
              ? streamingDraftLines
              : seg.kind === 'streaming_artifact'
                ? seg.lineCount
                : seg.code.split('\n').length;
          return (
            <div
              key={idx}
              data-testid="building-code-status"
              className="rounded-2xl border border-[#D2E3FC] dark:border-[#333537] bg-[#F8FAFD] dark:bg-[#1E1F20] px-4 py-3.5 shadow-xs"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#E8F0FE] dark:bg-[#004A77]/60 text-[#1A73E8] dark:text-[#8AB4F8]">
                    <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
                  </span>
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-[#1F1F1F] dark:text-[#F1F3F4]">
                      Writing &amp; verifying final code…
                    </div>
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-[#5F6368] dark:text-[#9AA0A6]">
                      <span>Artifact will unlock once final code passes all checks</span>
                      {lineCount > 0 && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="font-mono tabular-nums">{lineCount} lines</span>
                        </>
                      )}
                    </div>
                  </div>
                </div>
                <span className="shrink-0 rounded-full bg-[#E8F0FE] dark:bg-[#004A77]/50 px-2.5 py-1 text-[11px] font-medium text-[#1A73E8] dark:text-[#A8C7FA]">
                  In Progress
                </span>
              </div>
            </div>
          );
        }

        if (seg.kind === 'draft') {
          const copyId = `draft-${idx}`;
          return (
            <div
              key={idx}
              className="rounded-2xl border border-[#DDE3EA] dark:border-[#333537] bg-white dark:bg-[#1E1F20] overflow-hidden"
            >
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#E8EDF4] dark:border-[#2E3033] bg-[#F8FAFD] dark:bg-[#252628] px-4 py-2.5">
                <div className="flex items-center gap-2 text-xs font-medium text-[#444746] dark:text-[#C4C7C5]">
                  <span className="font-semibold text-[#1F1F1F] dark:text-[#F1F3F4]">
                    Email Draft
                  </span>
                  {seg.language && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span>{seg.language}</span>
                    </>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void handleCopy(copyId, seg.raw)}
                    className="inline-flex items-center gap-1.5 rounded-full border border-[#DDE3EA] dark:border-[#3C4043] bg-white dark:bg-[#282A2C] px-3 py-1 text-xs font-medium text-[#444746] dark:text-[#E3E3E3] hover:bg-[#F0F4F9] dark:hover:bg-[#333537] transition-colors whitespace-nowrap shrink-0"
                  >
                    {copiedKey === copyId ? (
                      <>
                        <Check className="h-3.5 w-3.5 text-[#188038] dark:text-[#81C995]" />
                        Copied
                      </>
                    ) : (
                      <>
                        <Copy className="h-3.5 w-3.5" />
                        Copy Draft
                      </>
                    )}
                  </button>
                  {onQueueDraft && (
                    <button
                      type="button"
                      onClick={() =>
                        onQueueDraft({
                          to: seg.to,
                          subject: seg.subject,
                          body: seg.body,
                          language: seg.language || 'English',
                        })
                      }
                      className="inline-flex items-center gap-1.5 rounded-full bg-[#1A73E8] px-3 py-1 text-xs font-medium text-white hover:bg-[#1557B0] transition-colors whitespace-nowrap shrink-0"
                    >
                      <MailPlus className="h-3.5 w-3.5" />
                      Queue Gmail Draft
                    </button>
                  )}
                </div>
              </div>
              <div className="px-4 py-3 space-y-2 text-sm">
                <div className="grid grid-cols-[64px_1fr] gap-y-1 text-xs text-[#5F6368] dark:text-[#9AA0A6] border-b border-[#F0F4F9] dark:border-[#2E3033] pb-2">
                  <span className="font-medium">To</span>
                  <span className="font-mono text-[#1F1F1F] dark:text-[#E3E3E3] break-all">
                    {seg.to || 'Missing recipient'}
                  </span>
                  <span className="font-medium">Subject</span>
                  <span className="font-medium text-[#1F1F1F] dark:text-[#E3E3E3]">
                    {seg.subject || 'Missing subject'}
                  </span>
                </div>
                <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-[#1F1F1F] dark:text-[#E3E3E3]">
                  {seg.body}
                </pre>
              </div>
            </div>
          );
        }

        // Claude-Style Interactive Website Artifact Card (replaces dumping 700 lines of raw HTML into chat!)
        if (websiteArtifact) {
          if (renderedWebsiteArtifactCard) {
            if (!showRawArtifactCode) {
              return null;
            }
          } else {
            renderedWebsiteArtifactCard = true;
            const artifactCopyId = `artifact-${idx}`;
            const openWebsiteInWorkbench = () => {
              if (onOpenArtifact) {
                onOpenArtifact({
                  title: websiteArtifact.title,
                  files: websiteArtifact.files,
                  activePath: websiteArtifact.activePath,
                });
              } else {
                onPreviewHtml(
                  buildPreviewableHtml(websiteArtifact.files, websiteArtifact.primaryHtml)
                );
              }
            };

            return (
              <div key={idx} className="space-y-3">
                <div
                  className={`rounded-2xl border transition-all overflow-hidden ${
                    isActiveArtifact
                      ? 'border-[#1A73E8] dark:border-[#8AB4F8] bg-[#F4F8FE] dark:bg-[#192331] shadow-sm'
                      : 'border-[#DDE3EA] dark:border-[#333537] bg-white dark:bg-[#1E1F20] hover:border-[#AECBFA] dark:hover:border-[#5F6368] shadow-xs'
                  }`}
                >
                  {/* Primary clickable Claude-style Artifact surface */}
                  <button
                    type="button"
                    onClick={openWebsiteInWorkbench}
                    className="flex w-full flex-col items-stretch gap-3 px-4 py-3.5 text-left transition-colors hover:bg-[#F8FAFD] dark:hover:bg-[#252628]/70 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="flex items-center gap-3.5 min-w-0">
                      <span
                        className={`inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border ${
                          isActiveArtifact
                            ? 'border-[#1A73E8]/30 bg-[#1A73E8] text-white'
                            : 'border-[#D2E3FC] dark:border-[#333537] bg-[#E8F0FE] dark:bg-[#004A77]/60 text-[#1A73E8] dark:text-[#8AB4F8]'
                        }`}
                      >
                        <Globe className="h-5 w-5" aria-hidden="true" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-[14.5px] font-semibold text-[#1F1F1F] dark:text-[#F1F3F4]">
                            {websiteArtifact.title}
                          </span>
                          {isActiveArtifact && (
                            <span className="shrink-0 rounded-full bg-[#E8F0FE] dark:bg-[#004A77] px-2 py-0.5 text-[10px] font-semibold text-[#1A73E8] dark:text-[#C2E7FF]">
                              Viewing
                            </span>
                          )}
                        </div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-[#5F6368] dark:text-[#9AA0A6]">
                          <span>Interactive Website Artifact</span>
                          <span aria-hidden="true">·</span>
                          <span className="font-mono text-[11px] tabular-nums">
                            {websiteArtifact.files.length > 1
                              ? `${websiteArtifact.files.length} files`
                              : websiteArtifact.activePath}
                          </span>
                          <span aria-hidden="true">·</span>
                          <span className="font-mono text-[11px] tabular-nums">
                            {websiteArtifact.totalLines}{' '}
                            {websiteArtifact.totalLines === 1 ? 'line' : 'lines'}
                          </span>
                        </div>
                      </div>
                    </div>

                    <span className="inline-flex items-center justify-center gap-1.5 rounded-full bg-[#1A73E8] px-3.5 py-2 sm:py-1.5 text-xs font-medium text-white shrink-0">
                      <PanelRightOpen className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>{isActiveArtifact ? 'Focus Preview' : 'Open Artifact'}</span>
                    </span>
                  </button>

                  {/* Secondary Artifact Action Bar */}
                  <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[#E8EDF4] dark:border-[#2E3033] bg-[#F8FAFD] dark:bg-[#18191A] px-4 py-2 text-xs">
                    <button
                      type="button"
                      onClick={() => setShowRawArtifactCode((prev) => !prev)}
                      className="inline-flex items-center gap-1.5 font-medium text-[#5F6368] dark:text-[#9AA0A6] hover:text-[#1F1F1F] dark:hover:text-[#E3E3E3] transition-colors"
                    >
                      <Code2 className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>{showRawArtifactCode ? 'Hide raw code' : 'View raw code'}</span>
                      {showRawArtifactCode ? (
                        <ChevronUp className="h-3.5 w-3.5" aria-hidden="true" />
                      ) : (
                        <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
                      )}
                    </button>

                    <div className="flex flex-wrap items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() =>
                          onPreviewHtml(
                            buildPreviewableHtml(
                              websiteArtifact.files,
                              websiteArtifact.primaryHtml
                            )
                          )
                        }
                        className="inline-flex items-center gap-1 rounded-full border border-[#DDE3EA] dark:border-[#3C4043] bg-white dark:bg-[#282A2C] px-2.5 py-1 text-[11px] font-medium text-[#444746] dark:text-[#E3E3E3] hover:bg-[#F0F4F9] dark:hover:bg-[#333537] transition-colors whitespace-nowrap"
                      >
                        <Eye className="h-3 w-3" aria-hidden="true" />
                        Fullscreen
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleCopy(artifactCopyId, websiteArtifact.primaryHtml)}
                        className="inline-flex items-center gap-1 rounded-full border border-[#DDE3EA] dark:border-[#3C4043] bg-white dark:bg-[#282A2C] px-2.5 py-1 text-[11px] font-medium text-[#444746] dark:text-[#E3E3E3] hover:bg-[#F0F4F9] dark:hover:bg-[#333537] transition-colors whitespace-nowrap"
                      >
                        {copiedKey === artifactCopyId ? (
                          <>
                            <Check className="h-3 w-3 text-[#188038] dark:text-[#81C995]" />
                            Copied
                          </>
                        ) : (
                          <>
                            <Copy className="h-3 w-3" />
                            Copy Code
                          </>
                        )}
                      </button>
                      {websiteArtifact.files.length > 1 ? (
                        plan === 'plus' ? (
                          <button
                            type="button"
                            onClick={handleDownloadZip}
                            className="inline-flex items-center gap-1 rounded-full border border-[#DDE3EA] dark:border-[#3C4043] bg-white dark:bg-[#282A2C] px-2.5 py-1 text-[11px] font-medium text-[#444746] dark:text-[#E3E3E3] hover:bg-[#F0F4F9] dark:hover:bg-[#333537] transition-colors whitespace-nowrap"
                          >
                            <Archive className="h-3 w-3" />
                            ZIP
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={onNavigatePlans}
                            className="inline-flex items-center gap-1 rounded-full border border-[#DDE3EA] dark:border-[#3C4043] bg-white dark:bg-[#282A2C] px-2.5 py-1 text-[11px] font-medium text-[#5F6368] dark:text-[#9AA0A6] hover:bg-[#F0F4F9] dark:hover:bg-[#333537] transition-colors whitespace-nowrap"
                          >
                            <Lock className="h-3 w-3" />
                            ZIP (Plus)
                          </button>
                        )
                      ) : (
                        <button
                          type="button"
                          onClick={() =>
                            handleDownload(
                              websiteArtifact.primaryHtml,
                              websiteArtifact.activePath
                            )
                          }
                          className="inline-flex items-center gap-1 rounded-full border border-[#DDE3EA] dark:border-[#3C4043] bg-white dark:bg-[#282A2C] px-2.5 py-1 text-[11px] font-medium text-[#444746] dark:text-[#E3E3E3] hover:bg-[#F0F4F9] dark:hover:bg-[#333537] transition-colors whitespace-nowrap"
                        >
                          <Download className="h-3 w-3" />
                          Download
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                {/* Optional raw code drawer if user explicitly clicks "View raw code" */}
                {showRawArtifactCode && (
                  <CodeBlockCard
                    code={seg.code}
                    language={seg.language}
                    filename={getSuggestedFilename(seg.language, idx, seg.filename)}
                    isSingleFileHtml={seg.isSingleFileHtml}
                    copied={copiedKey === `code-${idx}`}
                    onCopy={() => void handleCopy(`code-${idx}`, seg.code)}
                    onDownload={() =>
                      handleDownload(
                        seg.code,
                        getSuggestedFilename(seg.language, idx, seg.filename)
                      )
                    }
                    onOpenWorkbench={openWebsiteInWorkbench}
                    onPreviewHtml={
                      seg.isSingleFileHtml
                        ? () =>
                            onPreviewHtml(
                              buildPreviewableHtml(websiteArtifact.files, seg.code)
                            )
                        : undefined
                    }
                    onQueueSaveToDrive={
                      onQueueSaveToDrive
                        ? () =>
                            onQueueSaveToDrive({
                              name: getSuggestedFilename(seg.language, idx, seg.filename),
                              content: seg.code,
                            })
                        : undefined
                    }
                  />
                )}
              </div>
            );
          }
        }

        // Prism.js Syntax-Highlighted Code Block (non-website code or expanded secondary files)
        const copyId = `code-${idx}`;
        const filename = getSuggestedFilename(seg.language, idx, seg.filename);
        const workbenchFiles: GeneratedProjectFile[] =
          projectFiles.length > 0 && projectFiles.some((f) => f.path === filename)
            ? projectFiles
            : [{ path: filename, language: seg.language || 'text', content: seg.code }];
        return (
          <CodeBlockCard
            key={idx}
            code={seg.code}
            language={seg.language}
            filename={filename}
            isSingleFileHtml={seg.isSingleFileHtml}
            copied={copiedKey === copyId}
            onCopy={() => void handleCopy(copyId, seg.code)}
            onDownload={() => handleDownload(seg.code, filename)}
            onOpenWorkbench={
              onOpenArtifact
                ? () =>
                    onOpenArtifact({
                      title: filename,
                      files: workbenchFiles,
                      activePath: filename,
                    })
                : undefined
            }
            onPreviewHtml={
              seg.isSingleFileHtml
                ? () => onPreviewHtml(buildPreviewableHtml(projectFiles, seg.code))
                : undefined
            }
            onQueueSaveToDrive={
              onQueueSaveToDrive
                ? () => onQueueSaveToDrive({ name: filename, content: seg.code })
                : undefined
            }
          />
        );
      })}
    </div>
  );
}
