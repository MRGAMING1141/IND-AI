import { useEffect, useMemo, useState } from 'react';
import {
  Archive,
  Check,
  Code2,
  Copy,
  Download,
  Eye,
  FileCode2,
  FolderUp,
  Hash,
  Maximize2,
  Monitor,
  Pencil,
  RefreshCw,
  RotateCcw,
  Send,
  Smartphone,
  Sparkles,
  Tablet,
  WrapText,
  X,
} from 'lucide-react';
import { copyTextToClipboard } from '../utils/clipboard';
import { buildPreviewableHtml } from '../utils/messageParser';
import { injectPreviewApiShim, isPreviewableLanguage } from '../utils/previewShim';
import { getDisplayLanguageLabel, tokenizeCodeLines } from '../utils/syntaxHighlight';
import { buildZipBytes } from '../utils/zipBuilder';
import type { ArtifactSession, GeneratedProjectFile } from '../types/agent';

interface ArtifactWorkbenchProps {
  artifact: ArtifactSession;
  sending?: boolean;
  onUpdateFiles: (files: GeneratedProjectFile[], activePath: string) => void;
  onSelectVersion?: (versionNumber: number) => void;
  onPreviewFullscreen?: (html: string) => void;
  onClose: () => void;
  onQueueSaveToDrive?: (file: { name: string; content: string }) => void;
  onRefineWithAi: (instruction: string, activeFile: GeneratedProjectFile) => void;
}

type WorkbenchTab = 'preview' | 'code' | 'edit';
type ViewportSize = 'desktop' | 'tablet' | 'mobile';

const VIEWPORT_WIDTHS: Record<ViewportSize, string> = {
  desktop: 'w-full',
  tablet: 'w-[768px] max-w-full',
  mobile: 'w-[390px] max-w-full',
};

export function ArtifactWorkbench({
  artifact,
  sending = false,
  onUpdateFiles,
  onSelectVersion,
  onPreviewFullscreen,
  onClose,
  onQueueSaveToDrive,
  onRefineWithAi,
}: ArtifactWorkbenchProps) {
  const activeFile =
    artifact.files.find((f) => f.path === artifact.activePath) ?? artifact.files[0];

  const isProseArtifact = (file?: GeneratedProjectFile): boolean => {
    if (!file) return false;
    const lang = file.language.toLowerCase();
    const path = file.path.toLowerCase();
    return (
      lang === 'markdown' ||
      lang === 'md' ||
      lang === 'text' ||
      lang === 'txt' ||
      lang === 'plain' ||
      path.endsWith('.md') ||
      path.endsWith('.txt')
    );
  };

  const [originalFiles, setOriginalFiles] = useState<GeneratedProjectFile[]>(artifact.files);
  const [viewport, setViewport] = useState<ViewportSize>('desktop');
  const [showLineNumbers, setShowLineNumbers] = useState(true);
  const [wrapLines, setWrapLines] = useState(() => isProseArtifact(activeFile));
  const [copied, setCopied] = useState(false);
  const [refinePrompt, setRefinePrompt] = useState('');
  const [previewNonce, setPreviewNonce] = useState(0);

  const htmlFile = useMemo(
    () =>
      artifact.files.find((f) => isPreviewableLanguage(f.language, f.path)) ?? null,
    [artifact.files]
  );

  const canPreview = Boolean(htmlFile);
  const [activeTab, setActiveTab] = useState<WorkbenchTab>(canPreview ? 'preview' : 'code');

  // Reset original snapshot, wrap default, and default tab when switching to a different artifact
  useEffect(() => {
    setOriginalFiles(artifact.files);
    const hasPreview = artifact.files.some((f) => isPreviewableLanguage(f.language, f.path));
    setActiveTab(hasPreview ? 'preview' : 'code');
    const nextActive =
      artifact.files.find((f) => f.path === artifact.activePath) ?? artifact.files[0];
    setWrapLines(isProseArtifact(nextActive));
  }, [artifact.id]);

  // Ensure tab falls back to 'code' if current artifact has no previewable HTML/SVG
  useEffect(() => {
    if (activeTab === 'preview' && !canPreview) {
      setActiveTab('code');
    }
  }, [activeTab, canPreview]);

  const isActiveFileModified = useMemo(() => {
    if (!activeFile) return false;
    const orig = originalFiles.find((f) => f.path === activeFile.path);
    return orig ? orig.content !== activeFile.content : false;
  }, [activeFile, originalFiles]);

  const highlightedLines = useMemo(
    () => (activeFile ? tokenizeCodeLines(activeFile.content, activeFile.language) : []),
    [activeFile]
  );

  const previewSrcDoc = useMemo(() => {
    if (!htmlFile) return '';
    if (htmlFile.language.toLowerCase() === 'svg' || htmlFile.path.toLowerCase().endsWith('.svg')) {
      return `<!doctype html><html><body style="margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#F8FAFD;padding:24px;">${htmlFile.content}</body></html>`;
    }
    const merged = buildPreviewableHtml(artifact.files, htmlFile.content);
    return injectPreviewApiShim(merged);
  }, [artifact.files, htmlFile]);

  if (!activeFile) return null;

  const handleCopy = async () => {
    const ok = await copyTextToClipboard(activeFile.content);
    if (ok) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    }
  };

  const handleDownloadActive = () => {
    const blob = new Blob([activeFile.content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = activeFile.path.split('/').pop() || 'artifact.txt';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleDownloadZip = () => {
    if (artifact.files.length === 0) return;
    const zipBytes = buildZipBytes(
      artifact.files.map((f) => ({ path: f.path, content: f.content }))
    );
    const buffer = zipBytes.buffer.slice(
      zipBytes.byteOffset,
      zipBytes.byteOffset + zipBytes.byteLength
    ) as ArrayBuffer;
    const blob = new Blob([buffer], { type: 'application/zip' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'ind-agent-workbench.zip';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleCodeChange = (nextContent: string) => {
    const nextFiles = artifact.files.map((f) =>
      f.path === activeFile.path ? { ...f, content: nextContent } : f
    );
    onUpdateFiles(nextFiles, activeFile.path);
  };

  const handleResetActiveFile = () => {
    const orig = originalFiles.find((f) => f.path === activeFile.path);
    if (!orig) return;
    handleCodeChange(orig.content);
  };

  const handleSubmitRefine = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = refinePrompt.trim();
    if (!trimmed || sending) return;
    setRefinePrompt('');
    onRefineWithAi(trimmed, activeFile);
  };

  const lineCount = highlightedLines.length;
  const gutterDigits = Math.max(2, String(lineCount).length);
  const displayLang = getDisplayLanguageLabel(activeFile.language);

  return (
    <section
      aria-label="Live Artifacts Workbench"
      className="flex h-full min-h-0 w-full flex-col border-l border-[#DDE3EA] dark:border-[#2E3033] bg-[#F8FAFD] dark:bg-[#131314]"
    >
      {/* Top Workbench Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#E1E5EA] dark:border-[#2E3033] bg-white dark:bg-[#1E1F20] px-4 py-2.5">
        <div className="flex items-center gap-2 min-w-0">
          <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[#E8F0FE] dark:bg-[#004A77]/60 text-[#1A73E8] dark:text-[#8AB4F8]">
            <FileCode2 className="h-4 w-4" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <h2 className="truncate text-xs font-semibold text-[#1F1F1F] dark:text-[#E3E3E3]">
                {artifact.title}
              </h2>
              {artifact.versions && artifact.versions.length > 1 && onSelectVersion && (
                <div className="inline-flex items-center gap-0.5 rounded-full border border-[#DDE3EA] dark:border-[#333537] bg-[#F8FAFD] dark:bg-[#131314] p-0.5">
                  {artifact.versions.map((ver) => {
                    const isCur = (artifact.currentVersion ?? artifact.versions!.length) === ver.version;
                    return (
                      <button
                        key={ver.version}
                        type="button"
                        onClick={() => onSelectVersion(ver.version)}
                        className={`rounded-full px-1.5 py-0.5 font-mono text-[10px] font-semibold transition-colors ${
                          isCur
                            ? 'bg-[#1A73E8] text-white'
                            : 'text-[#5F6368] dark:text-[#9AA0A6] hover:text-[#1F1F1F] dark:hover:text-white'
                        }`}
                      >
                        v{ver.version}
                      </button>
                    );
                  })}
                </div>
              )}
              {isActiveFileModified && (
                <span className="rounded-full bg-[#FEF7E0] dark:bg-[#3F3108] px-1.5 py-0.5 text-[10px] font-medium text-[#B06000] dark:text-[#FDD663]">
                  Edited
                </span>
              )}
            </div>
            <div className="flex items-center gap-1.5 font-mono text-[11px] text-[#5F6368] dark:text-[#9AA0A6]">
              <span>{displayLang}</span>
              <span aria-hidden="true">·</span>
              <span className="truncate">{activeFile.path}</span>
              <span aria-hidden="true">·</span>
              <span className="tabular-nums">{lineCount} lines</span>
            </div>
          </div>
        </div>

        {/* Mode Switcher Tabs: Preview / Code / Edit */}
        <div
          className="inline-flex items-center rounded-full bg-[#F0F4F9] dark:bg-[#131314] p-0.5 border border-[#DDE3EA] dark:border-[#333537]"
          role="tablist"
          aria-label="Workbench view mode"
        >
          {canPreview && (
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'preview'}
              onClick={() => setActiveTab('preview')}
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors whitespace-nowrap ${
                activeTab === 'preview'
                  ? 'bg-white dark:bg-[#282A2C] text-[#1A73E8] dark:text-[#8AB4F8] shadow-xs'
                  : 'text-[#5F6368] dark:text-[#9AA0A6] hover:text-[#1F1F1F] dark:hover:text-[#E3E3E3]'
              }`}
            >
              <Eye className="h-3.5 w-3.5" aria-hidden="true" />
              Preview
            </button>
          )}
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'code'}
            onClick={() => setActiveTab('code')}
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors whitespace-nowrap ${
              activeTab === 'code'
                ? 'bg-white dark:bg-[#282A2C] text-[#1A73E8] dark:text-[#8AB4F8] shadow-xs'
                : 'text-[#5F6368] dark:text-[#9AA0A6] hover:text-[#1F1F1F] dark:hover:text-[#E3E3E3]'
            }`}
          >
            <Code2 className="h-3.5 w-3.5" aria-hidden="true" />
            Code
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'edit'}
            onClick={() => setActiveTab('edit')}
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors whitespace-nowrap ${
              activeTab === 'edit'
                ? 'bg-white dark:bg-[#282A2C] text-[#1A73E8] dark:text-[#8AB4F8] shadow-xs'
                : 'text-[#5F6368] dark:text-[#9AA0A6] hover:text-[#1F1F1F] dark:hover:text-[#E3E3E3]'
            }`}
          >
            <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
            Edit
          </button>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-1 shrink-0">
          {isActiveFileModified && (
            <button
              type="button"
              onClick={handleResetActiveFile}
              title="Reset edits to original"
              aria-label="Reset edits to original"
              className="inline-flex h-8 w-8 items-center justify-center rounded-full text-[#5F6368] dark:text-[#9AA0A6] hover:bg-[#F0F4F9] dark:hover:bg-[#282A2C] hover:text-[#1F1F1F] dark:hover:text-white transition-colors"
            >
              <RotateCcw className="h-3.5 w-3.5" />
            </button>
          )}
          <button
            type="button"
            onClick={() => void handleCopy()}
            title="Copy code"
            aria-label="Copy artifact code"
            className="inline-flex h-8 items-center gap-1 rounded-full px-2.5 text-xs font-medium text-[#444746] dark:text-[#C4C7C5] hover:bg-[#F0F4F9] dark:hover:bg-[#282A2C] transition-colors"
          >
            {copied ? (
              <>
                <Check className="h-3.5 w-3.5 text-[#188038] dark:text-[#81C995]" />
                <span className="hidden xl:inline">Copied</span>
              </>
            ) : (
              <>
                <Copy className="h-3.5 w-3.5" />
                <span className="hidden xl:inline">Copy</span>
              </>
            )}
          </button>
          <button
            type="button"
            onClick={handleDownloadActive}
            title="Download file"
            aria-label="Download active artifact file"
            className="inline-flex h-8 w-8 items-center justify-center rounded-full text-[#444746] dark:text-[#C4C7C5] hover:bg-[#F0F4F9] dark:hover:bg-[#282A2C] transition-colors"
          >
            <Download className="h-3.5 w-3.5" />
          </button>
          {artifact.files.length > 1 && (
            <button
              type="button"
              onClick={handleDownloadZip}
              title="Download all files (.zip)"
              aria-label="Download all artifact files as ZIP"
              className="inline-flex h-8 w-8 items-center justify-center rounded-full text-[#444746] dark:text-[#C4C7C5] hover:bg-[#F0F4F9] dark:hover:bg-[#282A2C] transition-colors"
            >
              <Archive className="h-3.5 w-3.5" />
            </button>
          )}
          {onQueueSaveToDrive && (
            <button
              type="button"
              onClick={() =>
                onQueueSaveToDrive({ name: activeFile.path, content: activeFile.content })
              }
              title="Save to Google Drive (Confirm First)"
              aria-label="Save active file to Google Drive"
              className="inline-flex h-8 w-8 items-center justify-center rounded-full text-[#444746] dark:text-[#C4C7C5] hover:bg-[#F0F4F9] dark:hover:bg-[#282A2C] transition-colors"
            >
              <FolderUp className="h-3.5 w-3.5" />
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close workbench"
            className="inline-flex h-8 w-8 items-center justify-center rounded-full text-[#5F6368] dark:text-[#9AA0A6] hover:bg-[#F0F4F9] dark:hover:bg-[#282A2C] hover:text-[#1F1F1F] dark:hover:text-white transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Multi-file Tabs Bar */}
      {artifact.files.length > 1 && (
        <div
          className="flex items-center gap-1 overflow-x-auto border-b border-[#E1E5EA] dark:border-[#2E3033] bg-[#F0F4F9]/80 dark:bg-[#18191A] px-3 py-1.5"
          role="tablist"
          aria-label="Project files"
        >
          {artifact.files.map((file) => {
            const isSelected = file.path === activeFile.path;
            const orig = originalFiles.find((o) => o.path === file.path);
            const dirty = orig ? orig.content !== file.content : false;
            return (
              <button
                key={file.path}
                type="button"
                role="tab"
                aria-selected={isSelected}
                onClick={() => onUpdateFiles(artifact.files, file.path)}
                className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 font-mono text-[11px] transition-colors whitespace-nowrap shrink-0 ${
                  isSelected
                    ? 'bg-white dark:bg-[#282A2C] font-semibold text-[#1F1F1F] dark:text-[#F1F3F4] shadow-xs'
                    : 'text-[#5F6368] dark:text-[#9AA0A6] hover:bg-white/60 dark:hover:bg-[#282A2C]/60'
                }`}
              >
                <span>{file.path}</span>
                {dirty && <span className="h-1.5 w-1.5 rounded-full bg-[#F9AB00]" />}
              </button>
            );
          })}
        </div>
      )}

      {/* Sub-Toolbar for Preview (Viewport Switcher + Reload + Fullscreen) */}
      {activeTab === 'preview' && canPreview && (
        <div className="flex items-center justify-between gap-2 border-b border-[#E8EDF4] dark:border-[#2E3033] bg-[#F8FAFD] dark:bg-[#18191A] px-4 py-1.5">
          <div className="flex items-center gap-1.5 min-w-0">
            <button
              type="button"
              onClick={() => setPreviewNonce((n) => n + 1)}
              title="Reload live preview"
              aria-label="Reload live preview"
              className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[#5F6368] dark:text-[#9AA0A6] hover:bg-[#E8EDF4] dark:hover:bg-[#282A2C] hover:text-[#1F1F1F] dark:hover:text-white transition-colors"
            >
              <RefreshCw className="h-3 w-3" />
            </button>
            {onPreviewFullscreen && htmlFile && (
              <button
                type="button"
                onClick={() =>
                  onPreviewFullscreen(buildPreviewableHtml(artifact.files, htmlFile.content))
                }
                title="Open fullscreen preview"
                aria-label="Open fullscreen preview"
                className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[#5F6368] dark:text-[#9AA0A6] hover:bg-[#E8EDF4] dark:hover:bg-[#282A2C] hover:text-[#1F1F1F] dark:hover:text-white transition-colors"
              >
                <Maximize2 className="h-3 w-3" />
              </button>
            )}
            <span className="text-[11px] text-[#5F6368] dark:text-[#9AA0A6] truncate">
              Live Artifact · Edits reflect instantly
            </span>
          </div>
          <div
            className="inline-flex items-center gap-0.5 rounded-full border border-[#DDE3EA] dark:border-[#333537] bg-white dark:bg-[#1E1F20] p-0.5"
            role="radiogroup"
            aria-label="Workbench preview viewport"
          >
            {(
              [
                { id: 'desktop', label: 'Desktop', icon: Monitor },
                { id: 'tablet', label: 'Tablet', icon: Tablet },
                { id: 'mobile', label: 'Mobile', icon: Smartphone },
              ] as const
            ).map((vp) => {
              const Icon = vp.icon;
              const active = viewport === vp.id;
              return (
                <button
                  key={vp.id}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => setViewport(vp.id)}
                  className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-medium transition-colors ${
                    active
                      ? 'bg-[#E8F0FE] dark:bg-[#004A77] text-[#1A73E8] dark:text-[#C2E7FF]'
                      : 'text-[#5F6368] dark:text-[#9AA0A6] hover:text-[#1F1F1F] dark:hover:text-white'
                  }`}
                >
                  <Icon className="h-3 w-3" aria-hidden="true" />
                  <span className="hidden sm:inline">{vp.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {activeTab === 'code' && (
        <div className="flex items-center justify-between gap-2 border-b border-[#282A2C] bg-[#1E1F20] px-4 py-1.5 text-[11px] text-[#9AA0A6]">
          <span>Prism.js syntax highlighting · Read-only view</span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setShowLineNumbers((v) => !v)}
              aria-pressed={showLineNumbers}
              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 transition-colors ${
                showLineNumbers
                  ? 'bg-[#333537] text-[#E3E3E3]'
                  : 'text-[#9AA0A6] hover:bg-[#282A2C]'
              }`}
            >
              <Hash className="h-3 w-3" />
              Lines
            </button>
            <button
              type="button"
              onClick={() => setWrapLines((v) => !v)}
              aria-pressed={wrapLines}
              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 transition-colors ${
                wrapLines ? 'bg-[#333537] text-[#E3E3E3]' : 'text-[#9AA0A6] hover:bg-[#282A2C]'
              }`}
            >
              <WrapText className="h-3 w-3" />
              Wrap
            </button>
          </div>
        </div>
      )}

      {/* Main Workbench Canvas */}
      <div className="min-h-0 flex-1 overflow-hidden">
        {activeTab === 'preview' && canPreview ? (
          <div className="flex h-full w-full items-stretch justify-center overflow-auto bg-[#EEF2F7] dark:bg-[#0E0F10] p-3">
            <div
              className={`h-full transition-all duration-200 ${VIEWPORT_WIDTHS[viewport]} rounded-xl border border-[#DDE3EA] dark:border-[#333537] bg-white shadow-md overflow-hidden`}
            >
              <iframe
                key={`${artifact.id}-${artifact.currentVersion ?? 1}-${previewNonce}`}
                title={`Live Preview: ${htmlFile?.path ?? artifact.title}`}
                srcDoc={previewSrcDoc}
                sandbox="allow-scripts allow-forms"
                className="h-full w-full border-0 bg-white"
              />
            </div>
          </div>
        ) : activeTab === 'code' ? (
          <div className="h-full w-full overflow-auto bg-[#131314] text-[#E3E3E3]">
            <pre
              className={`min-h-full py-4 px-3 text-[13px] leading-[1.6] font-mono ${
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
        ) : (
          <div className="flex h-full flex-col bg-[#131314]">
            <div className="flex items-center justify-between border-b border-[#282A2C] bg-[#1E1F20] px-4 py-1.5 text-[11px] text-[#9AA0A6]">
              <span>Live editor — changes sync to Preview automatically</span>
              {canPreview && (
                <button
                  type="button"
                  onClick={() => setActiveTab('preview')}
                  className="font-medium text-[#8AB4F8] hover:underline"
                >
                  View in Preview
                </button>
              )}
            </div>
            <label htmlFor="workbench-code-editor" className="sr-only">
              Edit artifact code
            </label>
            <textarea
              id="workbench-code-editor"
              value={activeFile.content}
              onChange={(e) => handleCodeChange(e.target.value)}
              spellCheck={false}
              className="h-full w-full flex-1 resize-none bg-[#131314] p-4 font-mono text-[13px] leading-[1.6] text-[#E3E3E3] focus:outline-none"
            />
          </div>
        )}
      </div>

      {/* Inline "Refine with AI" Bar */}
      <form
        onSubmit={handleSubmitRefine}
        className="shrink-0 border-t border-[#E1E5EA] dark:border-[#2E3033] bg-white dark:bg-[#1E1F20] px-3.5 py-2.5"
      >
        <div className="flex items-center gap-2 rounded-full border border-[#DDE3EA] dark:border-[#3C4043] bg-[#F8FAFD] dark:bg-[#131314] pl-3.5 pr-1.5 py-1 focus-within:border-[#1A73E8] dark:focus-within:border-[#8AB4F8]">
          <Sparkles
            className="h-3.5 w-3.5 shrink-0 text-[#1A73E8] dark:text-[#8AB4F8]"
            aria-hidden="true"
          />
          <label htmlFor="workbench-refine-input" className="sr-only">
            Refine this artifact with AI
          </label>
          <input
            id="workbench-refine-input"
            type="text"
            value={refinePrompt}
            onChange={(e) => setRefinePrompt(e.target.value)}
            disabled={sending}
            placeholder={`Refine ${activeFile.path} with AI (e.g. "add dark mode" or "fix alignment")...`}
            className="min-w-0 flex-1 bg-transparent py-1 text-xs text-[#1F1F1F] dark:text-[#E3E3E3] placeholder:text-[#5F6368] dark:placeholder:text-[#9AA0A6] focus:outline-none"
          />
          <button
            type="submit"
            disabled={!refinePrompt.trim() || sending}
            className="inline-flex h-7 items-center gap-1 rounded-full bg-[#1A73E8] px-3 text-xs font-medium text-white hover:bg-[#1557B0] disabled:opacity-40 transition-colors whitespace-nowrap shrink-0"
          >
            <Send className="h-3 w-3" aria-hidden="true" />
            <span>Refine</span>
          </button>
        </div>
      </form>
    </section>
  );
}
