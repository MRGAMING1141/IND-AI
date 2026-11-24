import { useState } from 'react';
import { AlertTriangle, Check, ExternalLink, Loader2, X } from 'lucide-react';
import { sanitizeExternalUrl } from '../utils/safetyEngine';
import type { ActionType, PendingAction } from '../types/agent';

const ACTION_LABELS: Record<ActionType, string> = {
  gmail_create_draft: 'Gmail · Save Draft',
  gmail_send_email: 'Gmail · Send Email',
  drive_save_file: 'Google Drive · Save New File',
  drive_update_file: 'Google Drive · Overwrite File',
  drive_delete_file: 'Google Drive · Move File to Trash',
};

interface ActionCardProps {
  action: PendingAction;
  onApprove: (id: string) => Promise<void>;
  onReject: (id: string) => Promise<void>;
  compact?: boolean;
}

export function ActionCard({ action, onApprove, onReject, compact = false }: ActionCardProps) {
  const [busy, setBusy] = useState<'approve' | 'reject' | null>(null);
  const [confirmingElevated, setConfirmingElevated] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const safeUrl = sanitizeExternalUrl(action.resultUrl);

  const handleApproveClick = async () => {
    if (action.riskLevel === 'elevated' && !confirmingElevated) {
      setConfirmingElevated(true);
      return;
    }
    setLocalError(null);
    setBusy('approve');
    try {
      await onApprove(action.id);
      setConfirmingElevated(false);
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Execution failed.');
    } finally {
      setBusy(null);
    }
  };

  const handleRejectClick = async () => {
    setLocalError(null);
    setBusy('reject');
    try {
      await onReject(action.id);
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Reject failed.');
    } finally {
      setBusy(null);
    }
  };

  const statusText =
    action.status === 'pending'
      ? 'Awaiting Approval'
      : action.status === 'approved'
        ? 'Executed'
        : action.status === 'rejected'
          ? 'Rejected'
          : 'Failed';

  const statusColor =
    action.status === 'pending'
      ? 'text-[#B06000] dark:text-[#FDD663]'
      : action.status === 'approved'
        ? 'text-[#188038] dark:text-[#81C995]'
        : 'text-[#C5221F] dark:text-[#F28B82]';

  const elevatedNote =
    action.type === 'drive_delete_file'
      ? 'Confirm carefully: this will move the selected file to Google Drive Trash. Click "Confirm & Execute" to proceed.'
      : action.type === 'drive_update_file'
        ? 'Confirm carefully: this will overwrite the existing file content in Google Drive. Click "Confirm & Execute" to proceed.'
        : 'Confirm execution: this action sends an external email immediately. Click "Confirm & Execute" to proceed.';

  return (
    <article className="rounded-2xl border border-[#DDE3EA] dark:border-[#333537] bg-white dark:bg-[#1E1F20] overflow-hidden">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[#E1E5EA] dark:border-[#2E3033] px-4 py-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-xs text-[#5F6368] dark:text-[#9AA0A6]">
            <span className="font-medium text-[#444746] dark:text-[#C4C7C5]">
              {ACTION_LABELS[action.type] ?? action.type}
            </span>
            <span aria-hidden="true">·</span>
            <span className={`font-semibold ${statusColor}`}>{statusText}</span>
            <span aria-hidden="true">·</span>
            <span className="font-mono tabular-nums">
              {new Date(action.createdAt).toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
              })}
            </span>
          </div>
          <h3 className="mt-1 text-sm font-semibold text-[#1F1F1F] dark:text-[#E3E3E3] break-words">
            {action.title}
          </h3>
          {action.summary && (
            <p className="mt-0.5 text-xs text-[#5F6368] dark:text-[#9AA0A6] break-words">
              {action.summary}
            </p>
          )}
        </div>
      </div>

      {action.warning && (
        <div className="flex items-start gap-2.5 border-b border-[#FDE293] dark:border-[#5C4400] bg-[#FEF7E0] dark:bg-[#332700] px-4 py-2.5 text-xs text-[#7A4F01] dark:text-[#FDD663]">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[#EA8600] dark:text-[#FDD663]" />
          <span>{action.warning}</span>
        </div>
      )}

      <div className="px-4 py-3 bg-[#F8FAFD] dark:bg-[#131314]/70">
        <div className="mb-1.5 text-xs font-medium text-[#5F6368] dark:text-[#9AA0A6]">
          Action Preview
        </div>
        <pre
          className={`overflow-x-auto whitespace-pre-wrap break-words rounded-xl border border-[#E1E5EA] dark:border-[#2E3033] bg-white dark:bg-[#1E1F20] p-3 font-mono text-xs leading-relaxed text-[#1F1F1F] dark:text-[#E3E3E3] ${
            compact ? 'max-h-44' : 'max-h-80'
          }`}
        >
          {action.previewText}
        </pre>
      </div>

      {(localError || action.errorMessage) && (
        <div className="border-t border-[#F9DEDC] dark:border-[#5C2B29] bg-[#FCE8E6] dark:bg-[#3C1E1E] px-4 py-2.5 text-xs text-[#B3261E] dark:text-[#F2B8B5]">
          {localError || action.errorMessage}
        </div>
      )}

      {action.status === 'approved' && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[#E1E5EA] dark:border-[#2E3033] bg-[#E6F4EA] dark:bg-[#133A22]/50 px-4 py-2.5 text-xs text-[#137333] dark:text-[#81C995]">
          <span>{action.resultMessage || 'Action completed.'}</span>
          {safeUrl && (
            <a
              href={safeUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 font-medium text-[#1A73E8] dark:text-[#8AB4F8] hover:underline whitespace-nowrap shrink-0"
            >
              Open link
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          )}
        </div>
      )}

      {action.status === 'rejected' && (
        <div className="border-t border-[#E1E5EA] dark:border-[#2E3033] bg-[#F8FAFD] dark:bg-[#282A2C]/60 px-4 py-2.5 text-xs text-[#5F6368] dark:text-[#9AA0A6]">
          {action.resultMessage || 'Rejected — no external action was taken.'}
        </div>
      )}

      {action.status === 'pending' && (
        <div className="border-t border-[#E1E5EA] dark:border-[#2E3033] bg-white dark:bg-[#1E1F20] px-4 py-3 space-y-2.5">
          {confirmingElevated && (
            <div className="rounded-xl border border-[#FDE293] dark:border-[#5C4400] bg-[#FEF7E0] dark:bg-[#332700] px-3 py-2 text-xs text-[#7A4F01] dark:text-[#FDD663]">
              {elevatedNote}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={busy !== null}
              onClick={handleApproveClick}
              className={`inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-xs font-medium text-white disabled:opacity-50 transition-colors whitespace-nowrap shrink-0 ${
                action.type === 'drive_delete_file' && confirmingElevated
                  ? 'bg-[#D93025] hover:bg-[#B3261E]'
                  : 'bg-[#1A73E8] dark:bg-[#8AB4F8] dark:text-[#041E49] hover:bg-[#1557B0] dark:hover:bg-[#A8C7FA]'
              }`}
            >
              {busy === 'approve' ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Check className="h-3.5 w-3.5" />
              )}
              {confirmingElevated ? 'Confirm & Execute' : 'Approve & Execute'}
            </button>

            <button
              type="button"
              disabled={busy !== null}
              onClick={handleRejectClick}
              className="inline-flex items-center gap-1.5 rounded-full border border-[#DDE3EA] dark:border-[#3C4043] bg-white dark:bg-[#282A2C] px-4 py-2 text-xs font-medium text-[#444746] dark:text-[#E3E3E3] hover:bg-[#F0F4F9] dark:hover:bg-[#333537] disabled:opacity-50 transition-colors whitespace-nowrap shrink-0"
            >
              {busy === 'reject' ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <X className="h-3.5 w-3.5" />
              )}
              Reject
            </button>

            {confirmingElevated && (
              <button
                type="button"
                onClick={() => setConfirmingElevated(false)}
                className="px-2 py-1.5 text-xs font-medium text-[#5F6368] dark:text-[#9AA0A6] hover:text-[#1F1F1F] dark:hover:text-[#E3E3E3] whitespace-nowrap shrink-0"
              >
                Cancel
              </button>
            )}
          </div>
        </div>
      )}
    </article>
  );
}
