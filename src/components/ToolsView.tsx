import { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  ExternalLink,
  FileCode2,
  FolderOpen,
  FolderPlus,
  HardDrive,
  Loader2,
  LogOut,
  Mail,
  RefreshCw,
  Save,
  Search,
  ShieldCheck,
  Trash2,
  Upload,
} from 'lucide-react';
import { GoogleSignInButton } from './GoogleSignInButton';
import {
  fetchDriveFileDetail,
  fetchDriveFiles,
  fetchGmailMessageDetail,
  fetchGmailMessages,
} from '../services/api';
import { extractErrorDisplay } from '../utils/apiResponse';
import { sanitizeExternalUrl } from '../utils/safetyEngine';
import type { DriveFileItem, GmailMessageItem, ToolStatusSummary } from '../types/agent';

interface ToolsViewProps {
  toolStatus: ToolStatusSummary;
  onRefreshStatus: () => Promise<void>;
  onConnectGmail: () => Promise<void>;
  onDisconnectGmail: () => Promise<void>;
  onConnectDrive: () => Promise<void>;
  onDisconnectDrive: () => Promise<void>;
  gmailBusy: boolean;
  gmailError: string | null;
  driveBusy: boolean;
  driveError: string | null;
  onSendPromptToAgent: (prompt: string, mode: 'coding' | 'business') => void;
  onQueueSaveToDrive: (file: { name: string; content: string }) => Promise<void>;
  onQueueDriveUpdate: (file: { fileId: string; name: string; content: string }) => Promise<void>;
  onQueueDriveDelete: (file: { fileId: string; name: string }) => Promise<void>;
}

export function ToolsView({
  toolStatus,
  onRefreshStatus,
  onConnectGmail,
  onDisconnectGmail,
  onConnectDrive,
  onDisconnectDrive,
  gmailBusy,
  gmailError,
  driveBusy,
  driveError,
  onSendPromptToAgent,
  onQueueSaveToDrive,
  onQueueDriveUpdate,
  onQueueDriveDelete,
}: ToolsViewProps) {
  const [activeTab, setActiveTab] = useState<'drive' | 'gmail'>('drive');

  // Google Drive state
  const [driveQuery, setDriveQuery] = useState('');
  const [driveFiles, setDriveFiles] = useState<DriveFileItem[]>([]);
  const [driveLoading, setDriveLoading] = useState(false);
  const [driveLocalError, setDriveLocalError] = useState<string | null>(null);
  const [selectedDriveFile, setSelectedDriveFile] = useState<DriveFileItem | null>(null);
  const [driveDetailLoading, setDriveDetailLoading] = useState(false);
  const [editedContent, setEditedContent] = useState('');
  const [showNewFileForm, setShowNewFileForm] = useState(false);
  const [newFileName, setNewFileName] = useState('');
  const [newFileContent, setNewFileContent] = useState('');
  const [openFileIdInput, setOpenFileIdInput] = useState('');
  const fileUploadRef = useRef<HTMLInputElement | null>(null);

  // Gmail state
  const [gmailQuery, setGmailQuery] = useState('');
  const [gmailMessages, setGmailMessages] = useState<GmailMessageItem[]>([]);
  const [gmailLoading, setGmailLoading] = useState(false);
  const [gmailLocalError, setGmailLocalError] = useState<string | null>(null);
  const [selectedEmail, setSelectedEmail] = useState<GmailMessageItem | null>(null);
  const [emailDetailLoading, setEmailDetailLoading] = useState(false);

  const loadDriveFiles = async (query = driveQuery) => {
    if (!toolStatus?.drive?.connected) return;
    setDriveLoading(true);
    setDriveLocalError(null);
    try {
      const files = await fetchDriveFiles(query);
      setDriveFiles(Array.isArray(files) ? files : []);
    } catch (err) {
      setDriveLocalError(extractErrorDisplay(err).message);
    } finally {
      setDriveLoading(false);
    }
  };

  const handleOpenDriveFile = async (fileId: string) => {
    const trimmedId = fileId.trim();
    if (!trimmedId) return;
    setDriveDetailLoading(true);
    setDriveLocalError(null);
    try {
      const detail = await fetchDriveFileDetail(trimmedId);
      setSelectedDriveFile(detail);
      setEditedContent(typeof detail.content === 'string' ? detail.content : '');
    } catch (err) {
      setDriveLocalError(extractErrorDisplay(err).message);
    } finally {
      setDriveDetailLoading(false);
    }
  };

  const handleLocalFilePick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      setNewFileName(file.name);
      setNewFileContent(text);
      setShowNewFileForm(true);
      setDriveLocalError(null);
    } catch {
      setDriveLocalError('Could not read the selected local file as text.');
    } finally {
      if (fileUploadRef.current) fileUploadRef.current.value = '';
    }
  };

  const handleQueueNewDriveFile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFileName.trim()) {
      setDriveLocalError('Enter a filename to save into the IND AGENT Drive folder.');
      return;
    }
    setDriveLocalError(null);
    try {
      await onQueueSaveToDrive({
        name: newFileName.trim(),
        content: newFileContent,
      });
      setNewFileName('');
      setNewFileContent('');
      setShowNewFileForm(false);
    } catch (err) {
      setDriveLocalError(extractErrorDisplay(err).message);
    }
  };

  const loadGmail = async (query = gmailQuery) => {
    if (!toolStatus?.gmail?.connected) return;
    setGmailLoading(true);
    setGmailLocalError(null);
    try {
      const msgs = await fetchGmailMessages(query);
      setGmailMessages(Array.isArray(msgs) ? msgs : []);
    } catch (err) {
      setGmailLocalError(extractErrorDisplay(err).message);
    } finally {
      setGmailLoading(false);
    }
  };

  const handleOpenEmail = async (id: string) => {
    setEmailDetailLoading(true);
    setGmailLocalError(null);
    try {
      const detail = await fetchGmailMessageDetail(id);
      setSelectedEmail(detail);
    } catch (err) {
      setGmailLocalError(extractErrorDisplay(err).message);
    } finally {
      setEmailDetailLoading(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'drive' && toolStatus?.drive?.connected && driveFiles.length === 0) {
      void loadDriveFiles('');
    }
    if (activeTab === 'gmail' && toolStatus?.gmail?.connected && gmailMessages.length === 0) {
      void loadGmail('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, toolStatus?.drive?.connected, toolStatus?.gmail?.connected]);

  const combinedDriveError = driveError || driveLocalError;
  const combinedGmailError = gmailError || gmailLocalError;

  return (
    <div className="h-full overflow-y-auto px-5 py-6 bg-white dark:bg-[#131314]">
      <div className="mx-auto max-w-5xl space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-4 border-b border-[#E1E5EA] dark:border-[#2E3033] pb-5">
          <div className="max-w-2xl">
            <h1 className="font-display text-2xl font-medium text-[#1F1F1F] dark:text-[#E3E3E3]">
              Connected Tools
            </h1>
            <p className="mt-1 text-sm text-[#5F6368] dark:text-[#9AA0A6]">
              Connect your own Google Drive and Gmail accounts. OAuth tokens are encrypted per user
              on the server (AES-256-GCM) and never stored in browser code.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void onRefreshStatus()}
            className="inline-flex items-center gap-1.5 rounded-full border border-[#DDE3EA] dark:border-[#3C4043] bg-white dark:bg-[#1E1F20] px-4 py-2 text-xs font-medium text-[#444746] dark:text-[#E3E3E3] hover:bg-[#F0F4F9] dark:hover:bg-[#282A2C] transition-colors whitespace-nowrap shrink-0"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Refresh Status
          </button>
        </div>

        {/* Per-User Connection Summary Cards */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {/* Google Drive Card */}
          <div className="flex flex-col justify-between rounded-2xl border border-[#E1E5EA] dark:border-[#333537] bg-[#F8FAFD] dark:bg-[#1E1F20] p-5 space-y-3">
            <div className="space-y-1">
              <div className="flex items-center justify-between gap-2">
                <span className="inline-flex items-center gap-2 text-sm font-semibold text-[#1F1F1F] dark:text-[#E3E3E3]">
                  <HardDrive className="h-4 w-4 text-[#444746] dark:text-[#C4C7C5]" aria-hidden="true" />
                  Google Drive
                </span>
                <span
                  className={`text-xs font-medium ${
                    toolStatus?.drive?.connected
                      ? 'text-[#188038] dark:text-[#81C995]'
                      : 'text-[#5F6368] dark:text-[#9AA0A6]'
                  }`}
                >
                  {toolStatus?.drive?.connected ? 'Connected' : 'Disconnected'}
                </span>
              </div>
              <p className="text-xs text-[#5F6368] dark:text-[#9AA0A6] truncate">
                {toolStatus?.drive?.connected
                  ? toolStatus.drive.accountLabel || 'Google Drive connected'
                  : 'Minimal scope: drive.file only (IND AGENT folder & files you pick)'}
              </p>
              <p className="text-[11px] font-mono text-[#5F6368] dark:text-[#8E918F]">
                Folder: {toolStatus?.drive?.folderName || 'IND AGENT'} · Scope: drive.file
              </p>
            </div>
            <div className="flex items-center gap-2">
              {toolStatus?.drive?.connected ? (
                <button
                  type="button"
                  disabled={driveBusy}
                  onClick={async () => {
                    await onDisconnectDrive();
                    setDriveFiles([]);
                    setSelectedDriveFile(null);
                  }}
                  className="inline-flex items-center gap-1.5 rounded-full border border-[#DDE3EA] dark:border-[#3C4043] bg-white dark:bg-[#282A2C] px-3.5 py-1.5 text-xs font-medium text-[#444746] dark:text-[#E3E3E3] hover:bg-[#F0F4F9] dark:hover:bg-[#333537] disabled:opacity-50 whitespace-nowrap shrink-0"
                >
                  <LogOut className="h-3.5 w-3.5" />
                  Disconnect
                </button>
              ) : (
                <GoogleSignInButton
                  onClick={() => {
                    setActiveTab('drive');
                    void onConnectDrive();
                  }}
                  disabled={driveBusy}
                  label={driveBusy ? 'Connecting...' : 'Connect Google Drive'}
                />
              )}
            </div>
          </div>

          {/* Gmail Card */}
          <div className="flex flex-col justify-between rounded-2xl border border-[#E1E5EA] dark:border-[#333537] bg-[#F8FAFD] dark:bg-[#1E1F20] p-5 space-y-3">
            <div className="space-y-1">
              <div className="flex items-center justify-between gap-2">
                <span className="inline-flex items-center gap-2 text-sm font-semibold text-[#1F1F1F] dark:text-[#E3E3E3]">
                  <Mail className="h-4 w-4 text-[#444746] dark:text-[#C4C7C5]" aria-hidden="true" />
                  Gmail
                </span>
                <span
                  className={`text-xs font-medium ${
                    toolStatus?.gmail?.connected
                      ? 'text-[#188038] dark:text-[#81C995]'
                      : 'text-[#5F6368] dark:text-[#9AA0A6]'
                  }`}
                >
                  {toolStatus?.gmail?.connected ? 'Connected' : 'Disconnected'}
                </span>
              </div>
              <p className="text-xs text-[#5F6368] dark:text-[#9AA0A6] truncate">
                {toolStatus?.gmail?.connected
                  ? toolStatus.gmail.accountLabel || 'Google account connected'
                  : 'Minimal scopes: read & compose (no delete access)'}
              </p>
              <p className="text-[11px] font-mono text-[#5F6368] dark:text-[#8E918F]">
                Scopes: gmail.readonly · gmail.compose
              </p>
            </div>
            <div className="flex items-center gap-2">
              {toolStatus?.gmail?.connected ? (
                <button
                  type="button"
                  disabled={gmailBusy}
                  onClick={async () => {
                    await onDisconnectGmail();
                    setGmailMessages([]);
                    setSelectedEmail(null);
                  }}
                  className="inline-flex items-center gap-1.5 rounded-full border border-[#DDE3EA] dark:border-[#3C4043] bg-white dark:bg-[#282A2C] px-3.5 py-1.5 text-xs font-medium text-[#444746] dark:text-[#E3E3E3] hover:bg-[#F0F4F9] dark:hover:bg-[#333537] disabled:opacity-50 whitespace-nowrap shrink-0"
                >
                  <LogOut className="h-3.5 w-3.5" />
                  Disconnect
                </button>
              ) : (
                <GoogleSignInButton
                  onClick={() => {
                    setActiveTab('gmail');
                    void onConnectGmail();
                  }}
                  disabled={gmailBusy}
                  label={gmailBusy ? 'Connecting...' : 'Connect Gmail'}
                />
              )}
            </div>
          </div>
        </div>

        {/* Tool Inspector Tabs */}
        <div
          className="flex items-center gap-1 rounded-full bg-[#F0F4F9] dark:bg-[#1E1F20] p-1 w-fit"
          role="tablist"
          aria-label="Tool workspace tabs"
        >
          {(
            [
              {
                id: 'drive',
                label: 'Google Drive',
                connected: Boolean(toolStatus?.drive?.connected),
                icon: HardDrive,
              },
              {
                id: 'gmail',
                label: 'Gmail',
                connected: Boolean(toolStatus?.gmail?.connected),
                icon: Mail,
              },
            ] as const
          ).map((tab) => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setActiveTab(tab.id)}
                className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                  active
                    ? 'bg-white dark:bg-[#282A2C] text-[#1F1F1F] dark:text-[#E3E3E3] shadow-sm'
                    : 'text-[#5F6368] dark:text-[#9AA0A6] hover:text-[#1F1F1F] dark:hover:text-[#E3E3E3]'
                }`}
              >
                <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                <span>{tab.label}</span>
                <span className={tab.connected ? 'text-[#188038] dark:text-[#81C995]' : 'text-[#8E918F]'}>
                  {tab.connected ? '· Live' : '· Off'}
                </span>
              </button>
            );
          })}
        </div>

        {/* GOOGLE DRIVE PANEL */}
        {activeTab === 'drive' && (
          <section className="space-y-4">
            {!toolStatus?.drive?.connected ? (
              <div className="rounded-2xl border border-[#E1E5EA] dark:border-[#333537] bg-[#F8FAFD] dark:bg-[#1E1F20] p-6 space-y-4">
                <div>
                  <h2 className="text-base font-semibold text-[#1F1F1F] dark:text-[#E3E3E3]">
                    Connect Google Drive
                  </h2>
                  <p className="mt-1 text-sm text-[#5F6368] dark:text-[#9AA0A6] max-w-2xl">
                    IND AGENT requests only the minimal{' '}
                    <code className="font-mono text-[#1F1F1F] dark:text-[#E3E3E3]">drive.file</code>{' '}
                    scope — never full Drive access. It can only access files created inside your{' '}
                    <strong className="text-[#1F1F1F] dark:text-[#E3E3E3]">IND AGENT</strong> folder
                    or files you explicitly open with the app. Every save, overwrite, or trash
                    action waits for your approval first.
                  </p>
                </div>

                {combinedDriveError && (
                  <div
                    role="alert"
                    className="rounded-xl border border-[#F9DEDC] dark:border-[#5C2B29] bg-[#FCE8E6] dark:bg-[#3C1E1E] px-3.5 py-2.5 text-xs text-[#B3261E] dark:text-[#F2B8B5]"
                  >
                    {combinedDriveError}
                  </div>
                )}

                <GoogleSignInButton
                  onClick={() => void onConnectDrive()}
                  disabled={driveBusy}
                  label={driveBusy ? 'Connecting Google Drive...' : 'Connect Google Drive'}
                />

                <div className="flex items-start gap-2 text-xs text-[#5F6368] dark:text-[#9AA0A6]">
                  <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>
                    Per-user encrypted storage: your Drive access token is encrypted with
                    AES-256-GCM on the server and cleared immediately if you disconnect.
                  </span>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                {/* Connected Bar */}
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#E1E5EA] dark:border-[#333537] bg-[#F8FAFD] dark:bg-[#1E1F20] px-4 py-3">
                  <div className="text-xs text-[#5F6368] dark:text-[#9AA0A6] space-y-0.5">
                    <div>
                      Connected as{' '}
                      <span className="font-medium text-[#1F1F1F] dark:text-[#E3E3E3]">
                        {toolStatus.drive.accountLabel || 'Google Drive user'}
                      </span>{' '}
                      · Folder{' '}
                      <span className="font-mono font-semibold text-[#1F1F1F] dark:text-[#E3E3E3]">
                        IND AGENT
                      </span>
                    </div>
                    <div className="text-[11px]">
                      Scope: drive.file (only app-created or user-opened files)
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      ref={fileUploadRef}
                      type="file"
                      className="hidden"
                      onChange={(e) => void handleLocalFilePick(e)}
                    />
                    <button
                      type="button"
                      onClick={() => fileUploadRef.current?.click()}
                      className="inline-flex items-center gap-1.5 rounded-full border border-[#DDE3EA] dark:border-[#3C4043] bg-white dark:bg-[#282A2C] px-3 py-1.5 text-xs font-medium text-[#444746] dark:text-[#E3E3E3] hover:bg-[#F0F4F9] dark:hover:bg-[#333537] whitespace-nowrap shrink-0"
                    >
                      <Upload className="h-3.5 w-3.5" />
                      Upload Local File
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowNewFileForm((prev) => !prev)}
                      className="inline-flex items-center gap-1.5 rounded-full bg-[#1F1F1F] dark:bg-[#E3E3E3] px-3.5 py-1.5 text-xs font-medium text-white dark:text-[#131314] hover:opacity-90 whitespace-nowrap shrink-0"
                    >
                      <FolderPlus className="h-3.5 w-3.5" />
                      {showNewFileForm ? 'Close Form' : 'New File (Confirm First)'}
                    </button>
                    <button
                      type="button"
                      disabled={driveBusy}
                      onClick={async () => {
                        await onDisconnectDrive();
                        setDriveFiles([]);
                        setSelectedDriveFile(null);
                      }}
                      className="rounded-full border border-[#DDE3EA] dark:border-[#3C4043] px-3 py-1.5 text-xs font-medium text-[#444746] dark:text-[#E3E3E3] hover:bg-[#F0F4F9] dark:hover:bg-[#282A2C] whitespace-nowrap shrink-0"
                    >
                      Disconnect
                    </button>
                  </div>
                </div>

                {combinedDriveError && (
                  <div
                    role="alert"
                    className="rounded-xl border border-[#F9DEDC] dark:border-[#5C2B29] bg-[#FCE8E6] dark:bg-[#3C1E1E] px-3.5 py-2.5 text-xs text-[#B3261E] dark:text-[#F2B8B5]"
                  >
                    {combinedDriveError}
                  </div>
                )}

                {/* Queue New File / Upload Form */}
                {showNewFileForm && (
                  <form
                    onSubmit={handleQueueNewDriveFile}
                    className="rounded-2xl border border-[#DDE3EA] dark:border-[#333537] bg-[#F8FAFD] dark:bg-[#1E1F20] p-4 space-y-3"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="text-sm font-semibold text-[#1F1F1F] dark:text-[#E3E3E3]">
                        Queue New File for &ldquo;IND AGENT&rdquo; Drive Folder
                      </h3>
                      <span className="text-xs text-[#5F6368] dark:text-[#9AA0A6]">
                        Requires confirmation in Approvals before saving
                      </span>
                    </div>
                    <div>
                      <label
                        htmlFor="drive-new-name"
                        className="block text-xs font-medium text-[#444746] dark:text-[#C4C7C5] mb-1"
                      >
                        Filename
                      </label>
                      <input
                        id="drive-new-name"
                        type="text"
                        value={newFileName}
                        onChange={(e) => setNewFileName(e.target.value)}
                        placeholder="e.g. landing-page.html or script.lua"
                        className="w-full rounded-xl border border-[#DDE3EA] dark:border-[#3C4043] bg-white dark:bg-[#131314] px-3 py-2 text-xs font-mono text-[#1F1F1F] dark:text-[#E3E3E3] focus:border-[#1A73E8] focus:outline-none"
                      />
                    </div>
                    <div>
                      <label
                        htmlFor="drive-new-content"
                        className="block text-xs font-medium text-[#444746] dark:text-[#C4C7C5] mb-1"
                      >
                        File Content
                      </label>
                      <textarea
                        id="drive-new-content"
                        rows={5}
                        value={newFileContent}
                        onChange={(e) => setNewFileContent(e.target.value)}
                        placeholder="Paste code or text content..."
                        className="w-full rounded-xl border border-[#DDE3EA] dark:border-[#3C4043] bg-white dark:bg-[#131314] px-3 py-2 text-xs font-mono text-[#1F1F1F] dark:text-[#E3E3E3] focus:border-[#1A73E8] focus:outline-none"
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="submit"
                        className="rounded-full bg-[#1A73E8] dark:bg-[#8AB4F8] px-4 py-1.5 text-xs font-medium text-white dark:text-[#041E49] hover:bg-[#1557B0] whitespace-nowrap shrink-0"
                      >
                        Queue Save to Drive
                      </button>
                      <button
                        type="button"
                        onClick={() => setShowNewFileForm(false)}
                        className="rounded-full border border-[#DDE3EA] dark:border-[#3C4043] bg-white dark:bg-[#282A2C] px-3.5 py-1.5 text-xs font-medium text-[#444746] dark:text-[#E3E3E3] hover:bg-[#F0F4F9] whitespace-nowrap shrink-0"
                      >
                        Cancel
                      </button>
                    </div>
                  </form>
                )}

                {/* Search & Open by ID Bar */}
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      void loadDriveFiles(driveQuery);
                    }}
                    className="flex items-center gap-2"
                  >
                    <div className="relative flex-1">
                      <Search className="pointer-events-none absolute left-3 top-2.5 h-3.5 w-3.5 text-[#5F6368] dark:text-[#9AA0A6]" />
                      <input
                        type="text"
                        value={driveQuery}
                        onChange={(e) => setDriveQuery(e.target.value)}
                        placeholder="Search files in IND AGENT folder..."
                        aria-label="Search Google Drive files"
                        className="w-full rounded-full border border-[#DDE3EA] dark:border-[#3C4043] bg-white dark:bg-[#1E1F20] pl-9 pr-3.5 py-2 text-xs text-[#1F1F1F] dark:text-[#E3E3E3] focus:border-[#1A73E8] focus:outline-none"
                      />
                    </div>
                    <button
                      type="submit"
                      disabled={driveLoading}
                      className="rounded-full bg-[#1A73E8] dark:bg-[#8AB4F8] px-4 py-2 text-xs font-medium text-white dark:text-[#041E49] hover:bg-[#1557B0] disabled:opacity-50 whitespace-nowrap shrink-0"
                    >
                      {driveLoading ? 'Searching...' : 'Search'}
                    </button>
                  </form>

                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      void handleOpenDriveFile(openFileIdInput);
                    }}
                    className="flex items-center gap-2"
                  >
                    <input
                      type="text"
                      value={openFileIdInput}
                      onChange={(e) => setOpenFileIdInput(e.target.value)}
                      placeholder="Open app-accessible file by Drive File ID..."
                      aria-label="Open Google Drive file by ID"
                      className="flex-1 rounded-full border border-[#DDE3EA] dark:border-[#3C4043] bg-white dark:bg-[#1E1F20] px-3.5 py-2 text-xs font-mono text-[#1F1F1F] dark:text-[#E3E3E3] focus:border-[#1A73E8] focus:outline-none"
                    />
                    <button
                      type="submit"
                      disabled={driveDetailLoading || !openFileIdInput.trim()}
                      className="inline-flex items-center gap-1 rounded-full border border-[#DDE3EA] dark:border-[#3C4043] bg-white dark:bg-[#1E1F20] px-3.5 py-2 text-xs font-medium text-[#444746] dark:text-[#E3E3E3] hover:bg-[#F0F4F9] dark:hover:bg-[#282A2C] disabled:opacity-50 whitespace-nowrap shrink-0"
                    >
                      <FolderOpen className="h-3.5 w-3.5" />
                      Open
                    </button>
                  </form>
                </div>

                {/* Files List + Editor Split */}
                <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
                  <div className="lg:col-span-2 rounded-2xl border border-[#E1E5EA] dark:border-[#333537] bg-white dark:bg-[#1E1F20] divide-y divide-[#E1E5EA] dark:divide-[#2E3033] overflow-hidden">
                    {driveLoading && driveFiles.length === 0 ? (
                      <div className="flex items-center gap-2 p-4 text-xs text-[#5F6368] dark:text-[#9AA0A6]">
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        Loading files from IND AGENT folder...
                      </div>
                    ) : driveFiles.length === 0 ? (
                      <div className="p-4 text-xs leading-relaxed text-[#5F6368] dark:text-[#9AA0A6]">
                        No files saved in your &ldquo;IND AGENT&rdquo; Drive folder yet. Generate
                        code in Command and click &ldquo;Save to Drive&rdquo;, or create/upload a
                        file above.
                      </div>
                    ) : (
                      driveFiles.map((file) => (
                        <button
                          key={file.id}
                          type="button"
                          onClick={() => void handleOpenDriveFile(file.id)}
                          className={`w-full p-3.5 text-left hover:bg-[#F8FAFD] dark:hover:bg-[#282A2C] transition-colors ${
                            selectedDriveFile?.id === file.id
                              ? 'bg-[#E8F0FE]/70 dark:bg-[#004A77]/35'
                              : ''
                          }`}
                        >
                          <div className="flex items-center gap-2 text-xs font-semibold text-[#1F1F1F] dark:text-[#E3E3E3] truncate">
                            <FileCode2 className="h-3.5 w-3.5 shrink-0 text-[#1A73E8] dark:text-[#8AB4F8]" />
                            <span className="truncate font-mono">{file.name}</span>
                          </div>
                          <div className="mt-1 flex items-center justify-between gap-2 text-[11px] text-[#5F6368] dark:text-[#9AA0A6]">
                            <span className="truncate">{file.mimeType}</span>
                            {file.modifiedTime && (
                              <span className="font-mono tabular-nums shrink-0">
                                {new Date(file.modifiedTime).toLocaleDateString()}
                              </span>
                            )}
                          </div>
                        </button>
                      ))
                    )}
                  </div>

                  <div className="lg:col-span-3 rounded-2xl border border-[#E1E5EA] dark:border-[#333537] bg-white dark:bg-[#1E1F20] p-4">
                    {driveDetailLoading ? (
                      <div className="flex items-center gap-2 text-xs text-[#5F6368] dark:text-[#9AA0A6]">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Reading file from Google Drive...
                      </div>
                    ) : !selectedDriveFile ? (
                      <p className="text-xs text-[#5F6368] dark:text-[#9AA0A6]">
                        Select a file on the left to inspect its contents, edit it with IND AGENT,
                        or queue a confirmed overwrite / trash action.
                      </p>
                    ) : (
                      <div className="space-y-3">
                        <div className="flex flex-wrap items-start justify-between gap-2 border-b border-[#E1E5EA] dark:border-[#2E3033] pb-3">
                          <div className="min-w-0">
                            <h3 className="font-mono text-sm font-semibold text-[#1F1F1F] dark:text-[#E3E3E3] break-all">
                              {selectedDriveFile.name}
                            </h3>
                            <p className="mt-0.5 font-mono text-[11px] text-[#5F6368] dark:text-[#9AA0A6]">
                              ID: {selectedDriveFile.id}
                            </p>
                          </div>
                          <div className="flex flex-wrap items-center gap-2">
                            {sanitizeExternalUrl(selectedDriveFile.webViewLink) && (
                              <a
                                href={sanitizeExternalUrl(selectedDriveFile.webViewLink)!}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 rounded-full border border-[#DDE3EA] dark:border-[#3C4043] bg-white dark:bg-[#282A2C] px-3 py-1.5 text-xs font-medium text-[#444746] dark:text-[#E3E3E3] hover:bg-[#F0F4F9] whitespace-nowrap shrink-0"
                              >
                                Open in Drive
                                <ExternalLink className="h-3 w-3" />
                              </a>
                            )}
                            <button
                              type="button"
                              onClick={() =>
                                onSendPromptToAgent(
                                  `Read my Google Drive file "${selectedDriveFile.name}" (fileId: "${selectedDriveFile.id}"). Review it and propose an updated version for my confirmation before overwriting.`,
                                  'coding'
                                )
                              }
                              className="rounded-full bg-[#1A73E8] dark:bg-[#8AB4F8] px-3.5 py-1.5 text-xs font-medium text-white dark:text-[#041E49] hover:bg-[#1557B0] whitespace-nowrap shrink-0"
                            >
                              Edit with IND AGENT
                            </button>
                          </div>
                        </div>

                        {selectedDriveFile.injectionFlagged && (
                          <div className="flex items-start gap-2 rounded-xl border border-[#F9DEDC] dark:border-[#5C2B29] bg-[#FCE8E6] dark:bg-[#3C1E1E] p-2.5 text-xs text-[#B3261E] dark:text-[#F2B8B5]">
                            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                            <div>
                              Prompt injection pattern detected in this file (
                              {(selectedDriveFile.injectionMatches ?? []).join(', ')}). Treated
                              strictly as untrusted file data.
                            </div>
                          </div>
                        )}

                        <textarea
                          rows={12}
                          value={editedContent}
                          onChange={(e) => setEditedContent(e.target.value)}
                          aria-label={`Content of ${selectedDriveFile.name}`}
                          className="w-full rounded-xl border border-[#2E3033] bg-[#131314] p-3 font-mono text-xs leading-relaxed text-[#E3E3E3] focus:border-[#8AB4F8] focus:outline-none"
                        />

                        <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                          <button
                            type="button"
                            onClick={() =>
                              void onQueueDriveUpdate({
                                fileId: selectedDriveFile.id,
                                name: selectedDriveFile.name,
                                content: editedContent,
                              })
                            }
                            className="inline-flex items-center gap-1.5 rounded-full bg-[#1F1F1F] dark:bg-[#E3E3E3] px-3.5 py-1.5 text-xs font-medium text-white dark:text-[#131314] hover:opacity-90 whitespace-nowrap shrink-0"
                          >
                            <Save className="h-3.5 w-3.5" />
                            Queue Overwrite (Confirm First)
                          </button>

                          <button
                            type="button"
                            onClick={() =>
                              void onQueueDriveDelete({
                                fileId: selectedDriveFile.id,
                                name: selectedDriveFile.name,
                              })
                            }
                            className="inline-flex items-center gap-1.5 rounded-full border border-[#F9DEDC] dark:border-[#5C2B29] bg-white dark:bg-[#3C1E1E] px-3.5 py-1.5 text-xs font-medium text-[#C5221F] dark:text-[#F2B8B5] hover:bg-[#FCE8E6] whitespace-nowrap shrink-0"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            Move to Trash (Confirm First)
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </section>
        )}

        {/* GMAIL PANEL */}
        {activeTab === 'gmail' && (
          <section className="space-y-4">
            {!toolStatus?.gmail?.connected ? (
              <div className="rounded-2xl border border-[#E1E5EA] dark:border-[#333537] bg-[#F8FAFD] dark:bg-[#1E1F20] p-6 space-y-4">
                <div>
                  <h2 className="text-base font-semibold text-[#1F1F1F] dark:text-[#E3E3E3]">
                    Connect Gmail
                  </h2>
                  <p className="mt-1 text-sm text-[#5F6368] dark:text-[#9AA0A6] max-w-2xl">
                    Sign in with Google to search messages, read customer inquiries, and save drafts
                    or send replies after explicit confirmation. Requested scopes are minimal (
                    <code className="font-mono text-[#1F1F1F] dark:text-[#E3E3E3]">
                      gmail.readonly
                    </code>{' '}
                    and{' '}
                    <code className="font-mono text-[#1F1F1F] dark:text-[#E3E3E3]">
                      gmail.compose
                    </code>
                    ) with zero delete permissions.
                  </p>
                </div>

                {combinedGmailError && (
                  <div
                    role="alert"
                    className="rounded-xl border border-[#F9DEDC] dark:border-[#5C2B29] bg-[#FCE8E6] dark:bg-[#3C1E1E] px-3.5 py-2.5 text-xs text-[#B3261E] dark:text-[#F2B8B5]"
                  >
                    {combinedGmailError}
                  </div>
                )}

                <GoogleSignInButton
                  onClick={() => void onConnectGmail()}
                  disabled={gmailBusy}
                  label={gmailBusy ? 'Connecting Gmail...' : 'Connect Gmail'}
                />

                <div className="flex items-start gap-2 text-xs text-[#5F6368] dark:text-[#9AA0A6]">
                  <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>
                    Per-user encrypted storage: your Gmail OAuth access token is encrypted with
                    AES-256-GCM on the server and cleared immediately if you disconnect.
                  </span>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#E1E5EA] dark:border-[#333537] bg-[#F8FAFD] dark:bg-[#1E1F20] px-4 py-3">
                  <div className="text-xs text-[#5F6368] dark:text-[#9AA0A6]">
                    Connected as{' '}
                    <span className="font-medium text-[#1F1F1F] dark:text-[#E3E3E3]">
                      {toolStatus.gmail.accountLabel || 'Google account'}
                    </span>
                  </div>
                  <button
                    type="button"
                    disabled={gmailBusy}
                    onClick={async () => {
                      await onDisconnectGmail();
                      setGmailMessages([]);
                      setSelectedEmail(null);
                    }}
                    className="rounded-full border border-[#DDE3EA] dark:border-[#3C4043] px-3.5 py-1.5 text-xs font-medium text-[#444746] dark:text-[#E3E3E3] hover:bg-[#F0F4F9] dark:hover:bg-[#282A2C] whitespace-nowrap shrink-0"
                  >
                    Disconnect
                  </button>
                </div>

                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void loadGmail(gmailQuery);
                  }}
                  className="flex items-center gap-2"
                >
                  <div className="relative flex-1">
                    <Search className="pointer-events-none absolute left-3 top-2.5 h-3.5 w-3.5 text-[#5F6368] dark:text-[#9AA0A6]" />
                    <input
                      type="text"
                      value={gmailQuery}
                      onChange={(e) => setGmailQuery(e.target.value)}
                      placeholder="Search Gmail (e.g. from:client@example.com or subject:invoice)"
                      aria-label="Search Gmail messages"
                      className="w-full rounded-full border border-[#DDE3EA] dark:border-[#3C4043] bg-white dark:bg-[#1E1F20] pl-9 pr-3.5 py-2 text-xs text-[#1F1F1F] dark:text-[#E3E3E3] focus:border-[#1A73E8] focus:outline-none"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={gmailLoading}
                    className="rounded-full bg-[#1A73E8] dark:bg-[#8AB4F8] px-4 py-2 text-xs font-medium text-white dark:text-[#041E49] hover:bg-[#1557B0] disabled:opacity-50 whitespace-nowrap shrink-0"
                  >
                    {gmailLoading ? 'Searching...' : 'Search'}
                  </button>
                </form>

                {combinedGmailError && (
                  <div
                    role="alert"
                    className="rounded-xl border border-[#F9DEDC] dark:border-[#5C2B29] bg-[#FCE8E6] dark:bg-[#3C1E1E] px-3.5 py-2.5 text-xs text-[#B3261E] dark:text-[#F2B8B5]"
                  >
                    {combinedGmailError}
                  </div>
                )}

                <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
                  <div className="lg:col-span-2 rounded-2xl border border-[#E1E5EA] dark:border-[#333537] bg-white dark:bg-[#1E1F20] divide-y divide-[#E1E5EA] dark:divide-[#2E3033] overflow-hidden">
                    {gmailLoading && gmailMessages.length === 0 ? (
                      <div className="flex items-center gap-2 p-4 text-xs text-[#5F6368] dark:text-[#9AA0A6]">
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        Loading messages...
                      </div>
                    ) : gmailMessages.length === 0 ? (
                      <div className="p-4 text-xs text-[#5F6368] dark:text-[#9AA0A6]">
                        No messages found for this search.
                      </div>
                    ) : (
                      gmailMessages.map((m) => (
                        <button
                          key={m.id}
                          type="button"
                          onClick={() => void handleOpenEmail(m.id)}
                          className={`w-full p-3.5 text-left hover:bg-[#F8FAFD] dark:hover:bg-[#282A2C] transition-colors ${
                            selectedEmail?.id === m.id
                              ? 'bg-[#E8F0FE]/70 dark:bg-[#004A77]/35'
                              : ''
                          }`}
                        >
                          <div className="text-xs font-semibold text-[#1F1F1F] dark:text-[#E3E3E3] truncate">
                            {m.subject || '(No subject)'}
                          </div>
                          <div className="mt-0.5 text-[11px] text-[#5F6368] dark:text-[#9AA0A6] truncate">
                            {m.from}
                          </div>
                          <p className="mt-1 text-[11px] text-[#5F6368] dark:text-[#8E918F] line-clamp-2">
                            {m.snippet}
                          </p>
                        </button>
                      ))
                    )}
                  </div>

                  <div className="lg:col-span-3 rounded-2xl border border-[#E1E5EA] dark:border-[#333537] bg-white dark:bg-[#1E1F20] p-4">
                    {emailDetailLoading ? (
                      <div className="flex items-center gap-2 text-xs text-[#5F6368] dark:text-[#9AA0A6]">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Reading email...
                      </div>
                    ) : !selectedEmail ? (
                      <p className="text-xs text-[#5F6368] dark:text-[#9AA0A6]">
                        Select an email on the left to inspect its content or hand off a reply draft
                        to IND AGENT.
                      </p>
                    ) : (
                      <div className="space-y-3">
                        <div className="flex flex-wrap items-start justify-between gap-2 border-b border-[#E1E5EA] dark:border-[#2E3033] pb-3">
                          <div className="min-w-0">
                            <h3 className="text-sm font-semibold text-[#1F1F1F] dark:text-[#E3E3E3] break-words">
                              {selectedEmail.subject || '(No subject)'}
                            </h3>
                            <p className="mt-0.5 text-xs text-[#5F6368] dark:text-[#9AA0A6] break-all">
                              From: {selectedEmail.from}
                            </p>
                            {selectedEmail.date && (
                              <p className="mt-0.5 font-mono text-[11px] text-[#5F6368] dark:text-[#8E918F]">
                                {selectedEmail.date}
                              </p>
                            )}
                          </div>
                          <button
                            type="button"
                            onClick={() =>
                              onSendPromptToAgent(
                                `Read Gmail message "${selectedEmail.id}" (Subject: "${selectedEmail.subject}", From: "${selectedEmail.from}") and draft a polite reply in the same language the customer used. Show me the draft and queue it as a Gmail draft for approval.`,
                                'business'
                              )
                            }
                            className="rounded-full bg-[#1A73E8] dark:bg-[#8AB4F8] px-3.5 py-1.5 text-xs font-medium text-white dark:text-[#041E49] hover:bg-[#1557B0] whitespace-nowrap shrink-0"
                          >
                            Draft Reply with IND AGENT
                          </button>
                        </div>

                        {selectedEmail.injectionFlagged && (
                          <div className="flex items-start gap-2 rounded-xl border border-[#F9DEDC] dark:border-[#5C2B29] bg-[#FCE8E6] dark:bg-[#3C1E1E] p-2.5 text-xs text-[#B3261E] dark:text-[#F2B8B5]">
                            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                            <div>
                              Prompt injection pattern detected in this email (
                              {(selectedEmail.injectionMatches ?? []).join(', ')}). Treated
                              strictly as untrusted text.
                            </div>
                          </div>
                        )}

                        <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-xl border border-[#E1E5EA] dark:border-[#2E3033] bg-[#F8FAFD] dark:bg-[#131314] p-3 font-sans text-xs leading-relaxed text-[#1F1F1F] dark:text-[#E3E3E3]">
                          {selectedEmail.body || selectedEmail.snippet}
                        </pre>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
