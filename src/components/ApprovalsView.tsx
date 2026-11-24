import { useState } from 'react';
import { ArrowLeft, Plus, ShieldAlert } from 'lucide-react';
import { ActionCard } from './ActionCard';
import type { ActionStatus, PendingAction } from '../types/agent';

interface ApprovalsViewProps {
  actions: PendingAction[];
  onApprove: (id: string) => Promise<void>;
  onReject: (id: string) => Promise<void>;
  onQueueDraft: (draft: { to: string; subject: string; body: string; language: string }) => Promise<void>;
  onGoToCommand: () => void;
}

export function ApprovalsView({
  actions,
  onApprove,
  onReject,
  onQueueDraft,
  onGoToCommand,
}: ApprovalsViewProps) {
  const [filter, setFilter] = useState<'all' | ActionStatus>('pending');
  const [showComposer, setShowComposer] = useState(false);
  const [to, setTo] = useState('');
  const [subject, setSubject] = useState('');
  const [language, setLanguage] = useState('English');
  const [body, setBody] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const safeActions = Array.isArray(actions) ? actions : [];
  const counts = {
    pending: safeActions.filter((a) => a.status === 'pending').length,
    approved: safeActions.filter((a) => a.status === 'approved').length,
    rejected: safeActions.filter((a) => a.status === 'rejected').length,
    all: safeActions.length,
  };

  const visible =
    filter === 'all' ? safeActions : safeActions.filter((a) => a.status === filter);

  const handleManualDraftSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!to.trim() || !subject.trim() || !body.trim()) {
      setFormError('Recipient, subject, and message body are all required.');
      return;
    }
    setFormError(null);
    setSubmitting(true);
    try {
      await onQueueDraft({
        to: to.trim(),
        subject: subject.trim(),
        body: body.trim(),
        language,
      });
      setTo('');
      setSubject('');
      setBody('');
      setShowComposer(false);
      setFilter('pending');
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to queue draft.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="h-full overflow-y-auto px-5 py-6 bg-white dark:bg-[#131314]">
      <div className="mx-auto max-w-4xl space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-4 border-b border-[#E1E5EA] dark:border-[#2E3033] pb-5">
          <div>
            <h1 className="font-display text-2xl font-medium text-[#1F1F1F] dark:text-[#E3E3E3]">
              Preview-First Approvals
            </h1>
            <p className="mt-1 text-sm text-[#5F6368] dark:text-[#9AA0A6]">
              Every external write — Gmail drafts, sent emails, and Google Drive saves, overwrites,
              or trash requests — waits here until you approve.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowComposer((prev) => !prev)}
            className="inline-flex items-center gap-1.5 rounded-full border border-[#DDE3EA] dark:border-[#3C4043] bg-white dark:bg-[#1E1F20] px-4 py-2 text-xs font-medium text-[#1F1F1F] dark:text-[#E3E3E3] hover:bg-[#F0F4F9] dark:hover:bg-[#282A2C] transition-colors whitespace-nowrap shrink-0"
          >
            <Plus className="h-3.5 w-3.5" />
            {showComposer ? 'Close Draft Form' : 'New Gmail Draft Preview'}
          </button>
        </div>

        {showComposer && (
          <form
            onSubmit={handleManualDraftSubmit}
            className="rounded-2xl border border-[#DDE3EA] dark:border-[#333537] bg-[#F8FAFD] dark:bg-[#1E1F20] p-5 space-y-4"
          >
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-[#1F1F1F] dark:text-[#E3E3E3]">
                Queue a Gmail Draft for Preview
              </h2>
              <span className="text-xs text-[#5F6368] dark:text-[#9AA0A6]">
                Saved as draft only after approval
              </span>
            </div>

            {formError && (
              <p className="text-xs font-medium text-[#C5221F] dark:text-[#F28B82]" role="alert">
                {formError}
              </p>
            )}

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="sm:col-span-2">
                <label
                  htmlFor="draft-to"
                  className="block text-xs font-medium text-[#444746] dark:text-[#C4C7C5] mb-1"
                >
                  To
                </label>
                <input
                  id="draft-to"
                  type="email"
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                  placeholder="customer@example.com"
                  className="w-full rounded-xl border border-[#DDE3EA] dark:border-[#3C4043] bg-white dark:bg-[#131314] px-3 py-2 text-sm text-[#1F1F1F] dark:text-[#E3E3E3] focus:border-[#1A73E8] focus:outline-none"
                />
              </div>
              <div>
                <label
                  htmlFor="draft-lang"
                  className="block text-xs font-medium text-[#444746] dark:text-[#C4C7C5] mb-1"
                >
                  Language
                </label>
                <select
                  id="draft-lang"
                  value={language}
                  onChange={(e) => setLanguage(e.target.value)}
                  className="w-full rounded-xl border border-[#DDE3EA] dark:border-[#3C4043] bg-white dark:bg-[#131314] px-3 py-2 text-sm text-[#1F1F1F] dark:text-[#E3E3E3] focus:border-[#1A73E8] focus:outline-none"
                >
                  <option value="English">English</option>
                  <option value="Hindi">Hindi</option>
                  <option value="Gujarati">Gujarati</option>
                </select>
              </div>
            </div>

            <div>
              <label
                htmlFor="draft-subject"
                className="block text-xs font-medium text-[#444746] dark:text-[#C4C7C5] mb-1"
              >
                Subject
              </label>
              <input
                id="draft-subject"
                type="text"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="Project Quote / Client Follow-up"
                className="w-full rounded-xl border border-[#DDE3EA] dark:border-[#3C4043] bg-white dark:bg-[#131314] px-3 py-2 text-sm text-[#1F1F1F] dark:text-[#E3E3E3] focus:border-[#1A73E8] focus:outline-none"
              />
            </div>

            <div>
              <label
                htmlFor="draft-body"
                className="block text-xs font-medium text-[#444746] dark:text-[#C4C7C5] mb-1"
              >
                Body
              </label>
              <textarea
                id="draft-body"
                rows={4}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="Write the message body..."
                className="w-full rounded-xl border border-[#DDE3EA] dark:border-[#3C4043] bg-white dark:bg-[#131314] px-3 py-2 text-sm text-[#1F1F1F] dark:text-[#E3E3E3] focus:border-[#1A73E8] focus:outline-none"
              />
            </div>

            <div className="flex items-center gap-2">
              <button
                type="submit"
                disabled={submitting}
                className="rounded-full bg-[#1A73E8] dark:bg-[#8AB4F8] px-4 py-2 text-xs font-medium text-white dark:text-[#041E49] hover:bg-[#1557B0] dark:hover:bg-[#A8C7FA] disabled:opacity-50 transition-colors whitespace-nowrap shrink-0"
              >
                {submitting ? 'Queuing...' : 'Add to Approval Queue'}
              </button>
              <button
                type="button"
                onClick={() => setShowComposer(false)}
                className="rounded-full border border-[#DDE3EA] dark:border-[#3C4043] bg-white dark:bg-[#282A2C] px-4 py-2 text-xs font-medium text-[#444746] dark:text-[#E3E3E3] hover:bg-[#F0F4F9] dark:hover:bg-[#333537] transition-colors whitespace-nowrap shrink-0"
              >
                Cancel
              </button>
            </div>
          </form>
        )}

        {/* Filter Segmented Control */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div
            className="flex max-w-full overflow-x-auto items-center gap-1 rounded-full bg-[#F0F4F9] dark:bg-[#1E1F20] p-1"
            role="tablist"
            aria-label="Filter approvals"
          >
            {(
              [
                { id: 'pending', label: `Pending (${counts.pending})` },
                { id: 'approved', label: `Executed (${counts.approved})` },
                { id: 'rejected', label: `Rejected (${counts.rejected})` },
                { id: 'all', label: `All (${counts.all})` },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={filter === tab.id}
                onClick={() => setFilter(tab.id)}
                className={`rounded-full px-3.5 py-1.5 text-xs font-medium tabular-nums transition-colors whitespace-nowrap shrink-0 ${
                  filter === tab.id
                    ? 'bg-white dark:bg-[#282A2C] text-[#1F1F1F] dark:text-[#E3E3E3] shadow-sm'
                    : 'text-[#5F6368] dark:text-[#9AA0A6] hover:text-[#1F1F1F] dark:hover:text-[#E3E3E3]'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-1.5 text-xs text-[#5F6368] dark:text-[#9AA0A6]">
            <ShieldAlert className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Every write requires explicit confirmation</span>
          </div>
        </div>

        {/* Action List */}
        {visible.length === 0 ? (
          <div className="rounded-2xl border border-[#E1E5EA] dark:border-[#333537] bg-[#F8FAFD] dark:bg-[#1E1F20] p-10 text-center space-y-3">
            <h2 className="text-sm font-semibold text-[#1F1F1F] dark:text-[#E3E3E3]">
              No {filter === 'all' ? '' : filter} actions right now
            </h2>
            <p className="mx-auto max-w-md text-xs leading-relaxed text-[#5F6368] dark:text-[#9AA0A6]">
              Ask IND AGENT to draft a customer reply or save/update code in your Google Drive
              &ldquo;IND AGENT&rdquo; folder. Each proposal will show up here for your review.
            </p>
            <div className="pt-1">
              <button
                type="button"
                onClick={onGoToCommand}
                className="inline-flex items-center gap-1.5 rounded-full bg-[#1F1F1F] dark:bg-[#E3E3E3] px-4 py-2 text-xs font-medium text-white dark:text-[#131314] hover:opacity-90 transition-opacity whitespace-nowrap shrink-0"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                Back to Command
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {visible.map((action) => (
              <ActionCard
                key={action.id}
                action={action}
                onApprove={onApprove}
                onReject={onReject}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
