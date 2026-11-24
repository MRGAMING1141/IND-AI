import { useEffect, useId, useRef, useState } from 'react';
import {
  ArrowRight,
  ArrowUp,
  Check,
  Copy,
  Loader2,
  Plus,
  RefreshCw,
  RotateCcw,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import { copyTextToClipboard } from '../utils/clipboard';
import {
  composePromptFromSelections,
  estimateSelectedClarityScore,
  formatOptimizationCategory,
  getClarityLabel,
  getDefaultSelectedSuggestionIds,
} from '../utils/promptOptimizerHelpers';
import type {
  PromptOptimizationFocus,
  PromptOptimizationResult,
} from '../types/agent';

interface PromptOptimizerPanelProps {
  open: boolean;
  rawPrompt: string;
  focus: PromptOptimizationFocus;
  loading: boolean;
  error: string | null;
  result: PromptOptimizationResult | null;
  sending: boolean;
  onChangeFocus: (focus: PromptOptimizationFocus) => void;
  onRetry: () => void;
  onClose: () => void;
  onApplyToComposer: (optimizedPrompt: string) => void;
  onSendOptimized: (optimizedPrompt: string) => void;
}

const FOCUS_OPTIONS: Array<{ id: PromptOptimizationFocus; label: string }> = [
  { id: 'balanced', label: 'Balanced' },
  { id: 'technical', label: 'Technical' },
  { id: 'concise', label: 'Concise' },
];

export function PromptOptimizerPanel({
  open,
  rawPrompt,
  focus,
  loading,
  error,
  result,
  sending,
  onChangeFocus,
  onRetry,
  onClose,
  onApplyToComposer,
  onSendOptimized,
}: PromptOptimizerPanelProps) {
  const titleId = useId();
  const editorRef = useRef<HTMLTextAreaElement | null>(null);

  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [editedPrompt, setEditedPrompt] = useState('');
  const [hasManualEdit, setHasManualEdit] = useState(false);
  const [showCompare, setShowCompare] = useState(false);
  const [copied, setCopied] = useState(false);
  const [activeQuestionIdx, setActiveQuestionIdx] = useState<number | null>(null);
  const [questionDraft, setQuestionDraft] = useState('');
  const [clarifyingNotes, setClarifyingNotes] = useState<string[]>([]);

  // Sync local selection and editor state whenever a fresh optimization result arrives
  useEffect(() => {
    if (!result) return;
    const defaults = getDefaultSelectedSuggestionIds(result.suggestions);
    setSelectedIds(defaults);
    setClarifyingNotes([]);
    setActiveQuestionIdx(null);
    setQuestionDraft('');
    setHasManualEdit(false);
    setEditedPrompt(composePromptFromSelections(result, defaults, []));
  }, [result]);

  // Close on Escape key
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const liveScore = result
    ? estimateSelectedClarityScore(result, selectedIds)
    : 0;
  const scoreDelta = result ? Math.max(0, liveScore - result.originalScore) : 0;

  const handleToggleSuggestion = (id: string) => {
    if (!result) return;
    const next = selectedIds.includes(id)
      ? selectedIds.filter((item) => item !== id)
      : [...selectedIds, id];
    setSelectedIds(next);
    setHasManualEdit(false);
    setEditedPrompt(composePromptFromSelections(result, next, clarifyingNotes));
  };

  const handleAddClarifyingAnswer = (question: string) => {
    if (!result) return;
    const answer = questionDraft.trim();
    if (!answer) return;
    const formatted = `${question.replace(/\?+$/, '')}: ${answer}`;
    const nextNotes = [...clarifyingNotes, formatted];
    setClarifyingNotes(nextNotes);
    setQuestionDraft('');
    setActiveQuestionIdx(null);
    setHasManualEdit(false);
    setEditedPrompt(composePromptFromSelections(result, selectedIds, nextNotes));
  };

  const handleRemoveClarifyingNote = (index: number) => {
    if (!result) return;
    const nextNotes = clarifyingNotes.filter((_, i) => i !== index);
    setClarifyingNotes(nextNotes);
    setHasManualEdit(false);
    setEditedPrompt(composePromptFromSelections(result, selectedIds, nextNotes));
  };

  const handleResetToRecommended = () => {
    if (!result) return;
    const defaults = getDefaultSelectedSuggestionIds(result.suggestions);
    setSelectedIds(defaults);
    setClarifyingNotes([]);
    setActiveQuestionIdx(null);
    setQuestionDraft('');
    setHasManualEdit(false);
    setEditedPrompt(composePromptFromSelections(result, defaults, []));
  };

  const handleCopyPrompt = async () => {
    if (!editedPrompt.trim()) return;
    const ok = await copyTextToClipboard(editedPrompt.trim());
    if (ok) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    }
  };

  const finalPrompt = editedPrompt.trim() || rawPrompt.trim();
  const canCommit = !loading && finalPrompt.length > 0 && !sending;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-[2px] p-0 sm:p-6"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-testid="prompt-optimizer-panel"
        className="flex w-full max-w-[920px] max-h-[90dvh] sm:max-h-[84vh] flex-col overflow-hidden rounded-t-3xl sm:rounded-2xl border border-[#DDE3EA] dark:border-[#333537] bg-white dark:bg-[#1E1F20] text-[#1F1F1F] dark:text-[#E3E3E3] shadow-[0_24px_64px_rgba(15,23,42,0.22)]"
      >
        {/* Header Bar */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#E8EDF4] dark:border-[#2E3033] px-5 sm:px-6 py-4">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <SlidersHorizontal
                className="h-4 w-4 shrink-0 text-[#1A73E8] dark:text-[#8AB4F8]"
                aria-hidden="true"
              />
              <h2
                id={titleId}
                className="text-base font-semibold tracking-tight text-[#1F1F1F] dark:text-[#F1F3F4]"
              >
                System Prompt Optimizer
              </h2>
            </div>

            {/* Clean unboxed inline metadata (Zero-Pill Discipline) */}
            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-[#5F6368] dark:text-[#9AA0A6]">
              {loading ? (
                <span>Analyzing prompt structure, constraints, and technical context…</span>
              ) : result ? (
                <>
                  <span>{result.detectedIntent}</span>
                  <span aria-hidden="true">·</span>
                  <span>{result.domain}</span>
                  <span aria-hidden="true">·</span>
                  <span className="font-mono tabular-nums text-[#1F1F1F] dark:text-[#E3E3E3]">
                    Clarity {result.originalScore}
                    <ArrowRight className="mx-1 inline h-3 w-3 text-[#5F6368]" aria-hidden="true" />
                    <strong className="font-semibold text-[#188038] dark:text-[#81C995]">
                      {liveScore}
                    </strong>
                    {scoreDelta > 0 ? ` (+${scoreDelta})` : ''}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>{getClarityLabel(liveScore)}</span>
                </>
              ) : (
                <span>Refine your raw input before sending it to Gemini</span>
              )}
            </div>
          </div>

          {/* Interactive Focus Segmented Control + Close */}
          <div className="flex items-center gap-2 shrink-0">
            <div
              role="tablist"
              aria-label="Optimization focus"
              className="inline-flex items-center gap-0.5 rounded-lg bg-[#F0F4F9] dark:bg-[#282A2C] p-1"
            >
              {FOCUS_OPTIONS.map((opt) => {
                const active = focus === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    disabled={loading}
                    onClick={() => onChangeFocus(opt.id)}
                    className={`rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 disabled:opacity-60 ${
                      active
                        ? 'bg-white dark:bg-[#131314] text-[#1F1F1F] dark:text-[#F1F3F4] shadow-xs'
                        : 'text-[#5F6368] dark:text-[#9AA0A6] hover:text-[#1F1F1F] dark:hover:text-white'
                    }`}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>

            <button
              type="button"
              onClick={onClose}
              aria-label="Close prompt optimizer"
              className="inline-flex h-10 w-10 items-center justify-center rounded-full text-[#5F6368] dark:text-[#9AA0A6] hover:bg-[#F0F4F9] dark:hover:bg-[#282A2C] hover:text-[#1F1F1F] dark:hover:text-white transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Scrollable Body */}
        <div className="min-h-0 flex-1 overflow-y-auto">
          {error ? (
            <div className="flex flex-col items-start gap-3 px-6 py-8">
              <p className="text-sm font-medium text-[#D93025] dark:text-[#F28B82]" role="alert">
                {error}
              </p>
              <button
                type="button"
                onClick={onRetry}
                className="inline-flex items-center gap-2 rounded-lg border border-[#DDE3EA] dark:border-[#3C4043] px-4 py-2 text-xs font-medium text-[#1F1F1F] dark:text-[#E3E3E3] hover:bg-[#F0F4F9] dark:hover:bg-[#282A2C] transition-colors whitespace-nowrap"
              >
                <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Try again</span>
              </button>
            </div>
          ) : loading && !result ? (
            /* Geometry-matched loading skeleton */
            <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.08fr)] divide-y lg:divide-y-0 lg:divide-x divide-[#E8EDF4] dark:divide-[#2E3033]">
              <div className="p-5 sm:p-6 space-y-4">
                <div className="h-4 w-40 rounded bg-[#E8EDF4] dark:bg-[#2C2D30] animate-pulse" />
                {[0, 1, 2].map((i) => (
                  <div key={i} className="space-y-2 py-2">
                    <div className="h-3.5 w-3/4 rounded bg-[#E8EDF4] dark:bg-[#2C2D30] animate-pulse" />
                    <div className="h-3 w-full rounded bg-[#F0F4F9] dark:bg-[#252628] animate-pulse" />
                  </div>
                ))}
              </div>
              <div className="p-5 sm:p-6 space-y-3">
                <div className="h-4 w-36 rounded bg-[#E8EDF4] dark:bg-[#2C2D30] animate-pulse" />
                <div className="h-48 w-full rounded-xl bg-[#F0F4F9] dark:bg-[#252628] animate-pulse" />
              </div>
            </div>
          ) : result ? (
            <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.08fr)] divide-y lg:divide-y-0 lg:divide-x divide-[#E8EDF4] dark:divide-[#2E3033]">
              {/* Left Column: Suggested Improvements & Optional Clarifications */}
              <div className="p-5 sm:p-6 space-y-5">
                <div>
                  <div className="flex items-baseline justify-between gap-2">
                    <h3 className="text-xs font-semibold text-[#1F1F1F] dark:text-[#F1F3F4]">
                      Suggested improvements
                    </h3>
                    <span className="font-mono text-[11px] tabular-nums text-[#5F6368] dark:text-[#9AA0A6]">
                      {selectedIds.length} of {result.suggestions.length} active
                    </span>
                  </div>
                  <p className="mt-1 text-xs leading-relaxed text-[#5F6368] dark:text-[#9AA0A6]">
                    {result.summary}
                  </p>
                </div>

                {/* Hairline-separated suggestion checklist (No nested cards) */}
                <div className="divide-y divide-[#EEF2F7] dark:divide-[#2A2B2E] border-y border-[#EEF2F7] dark:border-[#2A2B2E]">
                  {result.suggestions.map((suggestion) => {
                    const checked = selectedIds.includes(suggestion.id);
                    return (
                      <label
                        key={suggestion.id}
                        className="flex min-h-[44px] cursor-pointer items-start gap-3 py-3 transition-colors hover:bg-[#F8FAFD] dark:hover:bg-[#252628]/70 -mx-2 px-2 rounded-lg"
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => handleToggleSuggestion(suggestion.id)}
                          data-testid={`optimizer-suggestion-${suggestion.id}`}
                          className="mt-0.5 h-4 w-4 shrink-0 rounded border-[#BDC1C6] dark:border-[#5F6368] text-[#1A73E8] accent-[#1A73E8] focus:ring-2 focus:ring-[#1A73E8]/30"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                            <span className="text-[13px] font-medium text-[#1F1F1F] dark:text-[#F1F3F4]">
                              {suggestion.title}
                            </span>
                            <span className="text-[11px] text-[#5F6368] dark:text-[#9AA0A6]">
                              · {formatOptimizationCategory(suggestion.category)}
                            </span>
                          </div>
                          <p className="mt-0.5 text-xs leading-relaxed text-[#5F6368] dark:text-[#9AA0A6]">
                            {suggestion.detail}
                          </p>
                        </div>
                      </label>
                    );
                  })}
                </div>

                {/* Optional Clarifying Context Questions */}
                {result.clarifyingQuestions.length > 0 && (
                  <div className="space-y-2.5">
                    <h3 className="text-xs font-semibold text-[#1F1F1F] dark:text-[#F1F3F4]">
                      Optional context to clarify
                    </h3>
                    <div className="space-y-2">
                      {result.clarifyingQuestions.map((question, idx) => {
                        const isAnswering = activeQuestionIdx === idx;
                        return (
                          <div key={question} className="space-y-1.5">
                            <button
                              type="button"
                              onClick={() => {
                                if (isAnswering) {
                                  setActiveQuestionIdx(null);
                                  setQuestionDraft('');
                                } else {
                                  setActiveQuestionIdx(idx);
                                  setQuestionDraft('');
                                }
                              }}
                              className="flex w-full items-start gap-2 rounded-lg py-1.5 text-left text-xs text-[#444746] dark:text-[#C4C7C5] hover:text-[#1A73E8] dark:hover:text-[#8AB4F8] transition-colors"
                            >
                              <Plus
                                className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#1A73E8] dark:text-[#8AB4F8]"
                                aria-hidden="true"
                              />
                              <span className="leading-snug">{question}</span>
                            </button>
                            {isAnswering && (
                              <div className="flex items-center gap-2 pl-5">
                                <input
                                  type="text"
                                  value={questionDraft}
                                  onChange={(e) => setQuestionDraft(e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                      e.preventDefault();
                                      handleAddClarifyingAnswer(question);
                                    }
                                  }}
                                  placeholder="Type a short answer and press Enter…"
                                  autoFocus
                                  className="min-w-0 flex-1 rounded-lg border border-[#DDE3EA] dark:border-[#3C4043] bg-white dark:bg-[#131314] px-3 py-1.5 text-xs text-[#1F1F1F] dark:text-[#E3E3E3] placeholder:text-[#747775] focus:border-[#1A73E8] focus:outline-none"
                                />
                                <button
                                  type="button"
                                  onClick={() => handleAddClarifyingAnswer(question)}
                                  disabled={!questionDraft.trim()}
                                  className="rounded-lg bg-[#1A73E8] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#1557B0] disabled:opacity-45 whitespace-nowrap shrink-0"
                                >
                                  Add
                                </button>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>

                    {clarifyingNotes.length > 0 && (
                      <div className="pt-1 space-y-1">
                        {clarifyingNotes.map((note, idx) => (
                          <div
                            key={`${note}-${idx}`}
                            className="flex items-center justify-between gap-2 text-xs text-[#1F1F1F] dark:text-[#E3E3E3]"
                          >
                            <span className="truncate">Added: {note}</span>
                            <button
                              type="button"
                              onClick={() => handleRemoveClarifyingNote(idx)}
                              aria-label="Remove added context"
                              className="text-[#5F6368] hover:text-[#D93025] text-[11px] shrink-0"
                            >
                              Remove
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Right Column: Editable Refined Prompt & Original Comparison */}
              <div className="flex flex-col p-5 sm:p-6 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <label
                    htmlFor="optimized-prompt-editor"
                    className="text-xs font-semibold text-[#1F1F1F] dark:text-[#F1F3F4]"
                  >
                    Refined prompt for Gemini
                  </label>
                  <div className="flex items-center gap-3 text-xs">
                    <button
                      type="button"
                      onClick={() => setShowCompare((v) => !v)}
                      aria-pressed={showCompare}
                      data-testid="optimizer-compare-toggle"
                      className={`font-medium transition-colors whitespace-nowrap ${
                        showCompare
                          ? 'text-[#1A73E8] dark:text-[#8AB4F8]'
                          : 'text-[#5F6368] dark:text-[#9AA0A6] hover:text-[#1F1F1F] dark:hover:text-white'
                      }`}
                    >
                      {showCompare ? 'Hide original' : 'Compare original'}
                    </button>
                    <button
                      type="button"
                      onClick={handleResetToRecommended}
                      className="inline-flex items-center gap-1 text-[#5F6368] dark:text-[#9AA0A6] hover:text-[#1F1F1F] dark:hover:text-white transition-colors whitespace-nowrap"
                    >
                      <RotateCcw className="h-3 w-3" aria-hidden="true" />
                      <span>Reset</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleCopyPrompt()}
                      className="inline-flex items-center gap-1 text-[#5F6368] dark:text-[#9AA0A6] hover:text-[#1F1F1F] dark:hover:text-white transition-colors whitespace-nowrap"
                    >
                      {copied ? (
                        <>
                          <Check className="h-3 w-3 text-[#188038] dark:text-[#81C995]" aria-hidden="true" />
                          <span className="text-[#188038] dark:text-[#81C995]">Copied</span>
                        </>
                      ) : (
                        <>
                          <Copy className="h-3 w-3" aria-hidden="true" />
                          <span>Copy</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>

                {showCompare && (
                  <div
                    data-testid="optimizer-original-compare"
                    className="rounded-xl border border-[#E8EDF4] dark:border-[#2E3033] bg-[#F8FAFD] dark:bg-[#131314] px-3.5 py-2.5 space-y-1"
                  >
                    <div className="flex items-center justify-between text-[11px] text-[#5F6368] dark:text-[#9AA0A6]">
                      <span>Original draft</span>
                      <span className="font-mono tabular-nums">
                        {result.originalPrompt.length} chars
                      </span>
                    </div>
                    <p className="whitespace-pre-wrap text-xs leading-relaxed text-[#444746] dark:text-[#C4C7C5]">
                      {result.originalPrompt}
                    </p>
                  </div>
                )}

                <div className="relative flex-1 flex flex-col">
                  <textarea
                    ref={editorRef}
                    id="optimized-prompt-editor"
                    data-testid="optimizer-prompt-textarea"
                    value={editedPrompt}
                    onChange={(e) => {
                      setEditedPrompt(e.target.value);
                      setHasManualEdit(true);
                    }}
                    rows={10}
                    className="min-h-[210px] w-full flex-1 resize-y rounded-xl border border-[#DDE3EA] dark:border-[#3C4043] bg-[#F8FAFD] dark:bg-[#131314] p-3.5 text-[13.5px] leading-relaxed text-[#1F1F1F] dark:text-[#E3E3E3] focus:border-[#1A73E8] dark:focus:border-[#8AB4F8] focus:bg-white dark:focus:bg-[#131314] focus:outline-none"
                  />
                  {loading && (
                    <div className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-xl bg-white/70 dark:bg-[#131314]/70">
                      <span className="inline-flex items-center gap-2 text-xs font-medium text-[#1A73E8] dark:text-[#8AB4F8]">
                        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                        Updating for {focus} focus…
                      </span>
                    </div>
                  )}
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-[#5F6368] dark:text-[#9AA0A6]">
                  <span>
                    {hasManualEdit
                      ? 'Custom edits applied'
                      : 'Toggle suggestions on the left or edit directly'}
                  </span>
                  <span className="font-mono tabular-nums">
                    {editedPrompt.trim().length} chars
                  </span>
                </div>
              </div>
            </div>
          ) : null}
        </div>

        {/* Sticky Action Footer */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#E8EDF4] dark:border-[#2E3033] bg-[#F8FAFD] dark:bg-[#191A1C] px-5 sm:px-6 py-3.5">
          <button
            type="button"
            onClick={onClose}
            className="min-h-[40px] rounded-lg px-3 py-2 text-xs font-medium text-[#5F6368] dark:text-[#9AA0A6] hover:bg-[#E8EDF4]/70 dark:hover:bg-[#282A2C] hover:text-[#1F1F1F] dark:hover:text-white transition-colors whitespace-nowrap shrink-0"
          >
            Keep original
          </button>

          <div className="flex items-center gap-2.5">
            <button
              type="button"
              disabled={!canCommit}
              data-testid="optimizer-apply-btn"
              onClick={() => onApplyToComposer(finalPrompt)}
              className="min-h-[40px] rounded-lg border border-[#DDE3EA] dark:border-[#3C4043] bg-white dark:bg-[#282A2C] px-4 py-2 text-xs font-medium text-[#1F1F1F] dark:text-[#E3E3E3] hover:bg-[#F0F4F9] dark:hover:bg-[#333537] disabled:opacity-45 transition-colors whitespace-nowrap shrink-0"
            >
              Apply to composer
            </button>
            <button
              type="button"
              disabled={!canCommit}
              data-testid="optimizer-send-btn"
              onClick={() => onSendOptimized(finalPrompt)}
              className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg bg-[#1A73E8] px-4 py-2 text-xs font-medium text-white hover:bg-[#1557B0] disabled:opacity-45 transition-colors whitespace-nowrap shrink-0"
            >
              <span>Send optimized</span>
              <ArrowUp className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
