import { useState } from 'react';
import { CheckCircle2, Circle, Clock, Mail, Plus, Trash2 } from 'lucide-react';
import { calculateQuoteTotals } from '../utils/safetyEngine';
import type { BusinessTask, QuoteLineItem, WorkspaceCategory } from '../types/agent';

interface BusinessViewProps {
  tasks: BusinessTask[];
  onAddTask: (task: Omit<BusinessTask, 'id' | 'createdAt' | 'status'>) => void;
  onCycleTaskStatus: (id: string) => void;
  onRemoveTask: (id: string) => void;
  onSendToAgent: (prompt: string) => void;
}

const WORKSPACES: WorkspaceCategory[] = ['Product & Web', 'Client Operations', 'Side Projects'];

export function BusinessView({
  tasks,
  onAddTask,
  onCycleTaskStatus,
  onRemoveTask,
  onSendToAgent,
}: BusinessViewProps) {
  const [filterWorkspace, setFilterWorkspace] = useState<'All' | WorkspaceCategory>('All');

  // New Task form
  const [workspace, setWorkspace] = useState<WorkspaceCategory>('Client Operations');
  const [category, setCategory] = useState<BusinessTask['category']>('Order');
  const [title, setTitle] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');
  const [language, setLanguage] = useState<'English' | 'Hindi' | 'Gujarati'>('English');
  const [amountInput, setAmountInput] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [notes, setNotes] = useState('');
  const [taskFormError, setTaskFormError] = useState<string | null>(null);

  // Exact Quote Builder state
  const [quoteWorkspace, setQuoteWorkspace] = useState<WorkspaceCategory>('Client Operations');
  const [quoteCustomer, setQuoteCustomer] = useState('');
  const [quoteEmail, setQuoteEmail] = useState('');
  const [quoteLang, setQuoteLang] = useState<'English' | 'Hindi' | 'Gujarati'>('English');
  const [gstPercent, setGstPercent] = useState<number>(18);
  const [lineItems, setLineItems] = useState<QuoteLineItem[]>([
    {
      id: 'item-1',
      description: 'Web Development & Maintenance Package',
      quantity: 1,
      unitPriceInr: 15000,
    },
  ]);

  const safeTasks = Array.isArray(tasks) ? tasks : [];
  const safeLineItems = Array.isArray(lineItems) ? lineItems : [];
  const quoteCalc = calculateQuoteTotals(safeLineItems, gstPercent);

  const visibleTasks =
    filterWorkspace === 'All'
      ? safeTasks
      : safeTasks.filter((t) => t.workspace === filterWorkspace);

  const handleTaskSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      setTaskFormError('Task or order title is required.');
      return;
    }
    const parsedAmount = amountInput.trim() === '' ? null : Number(amountInput);
    if (parsedAmount !== null && (!Number.isFinite(parsedAmount) || parsedAmount < 0)) {
      setTaskFormError('Amount (INR) must be a valid non-negative number.');
      return;
    }
    setTaskFormError(null);
    onAddTask({
      workspace,
      category,
      title: title.trim(),
      customerName: customerName.trim() || undefined,
      customerEmail: customerEmail.trim() || undefined,
      language,
      amountInr: parsedAmount,
      dueDate: dueDate || undefined,
      notes: notes.trim(),
    });
    setTitle('');
    setCustomerName('');
    setCustomerEmail('');
    setAmountInput('');
    setDueDate('');
    setNotes('');
  };

  const handleAddLineItem = () => {
    setLineItems((prev) => [
      ...(Array.isArray(prev) ? prev : []),
      {
        id: `item-${Date.now()}`,
        description: '',
        quantity: '',
        unitPriceInr: '',
      },
    ]);
  };

  const handleUpdateLineItem = (
    id: string,
    field: keyof QuoteLineItem,
    raw: string
  ) => {
    setLineItems((prev) =>
      (Array.isArray(prev) ? prev : []).map((item) => {
        if (item.id !== id) return item;
        if (field === 'description') {
          return { ...item, description: raw };
        }
        return {
          ...item,
          [field]: raw === '' ? '' : Number(raw),
        };
      })
    );
  };

  const handleSendQuoteToAgent = () => {
    if (!quoteCalc.valid) return;
    const itemLines = safeLineItems
      .map(
        (item, i) =>
          `${i + 1}. ${item.description} — Qty: ${item.quantity} x ₹${Number(item.unitPriceInr).toFixed(2)} = ₹${(
            Number(item.quantity) * Number(item.unitPriceInr)
          ).toFixed(2)}`
      )
      .join('\n');

    const prompt = [
      `Draft a professional but friendly ${quoteLang} quote email for ${quoteWorkspace}.`,
      `Customer name: ${quoteCustomer.trim() || '[ASK USER IF NEEDED]'}`,
      `Recipient email: ${quoteEmail.trim() || '[ASK USER FOR EMAIL]'}`,
      `Verified line items (use these exact numbers, do not alter):`,
      itemLines,
      `Subtotal: ₹${quoteCalc.subtotalInr.toFixed(2)}`,
      `Tax (${gstPercent}%): ₹${quoteCalc.gstAmountInr.toFixed(2)}`,
      `Grand Total: ₹${quoteCalc.totalInr.toFixed(2)}`,
      quoteEmail.trim()
        ? 'Also queue this as a Gmail draft for my approval.'
        : 'Ask me for the recipient email before queuing as a Gmail draft.',
    ].join('\n');

    onSendToAgent(prompt);
  };

  const formatInr = (val: number) =>
    `₹${val.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const inputClass =
    'w-full rounded-xl border border-[#DDE3EA] dark:border-[#3C4043] bg-white dark:bg-[#131314] px-3 py-1.5 text-xs text-[#1F1F1F] dark:text-[#E3E3E3] focus:border-[#1A73E8] focus:outline-none';

  return (
    <div className="h-full overflow-y-auto px-5 py-6 bg-white dark:bg-[#131314]">
      <div className="mx-auto max-w-6xl space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-4 border-b border-[#E1E5EA] dark:border-[#2E3033] pb-5">
          <div>
            <h1 className="font-display text-2xl font-medium text-[#1F1F1F] dark:text-[#E3E3E3]">
              Business Operations
            </h1>
            <p className="mt-1 text-sm text-[#5F6368] dark:text-[#9AA0A6]">
              Track client orders, support items, and build exact verified quotes to hand off to IND
              AGENT. Stored locally in your browser.
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              const summaryLines = safeTasks
                .filter((t) => t.status !== 'done')
                .map(
                  (t) =>
                    `- [${t.workspace} · ${t.category}] ${t.title}${
                      t.amountInr != null ? ` (₹${t.amountInr})` : ''
                    }${t.dueDate ? ` · Due ${t.dueDate}` : ''}`
                )
                .join('\n');
              onSendToAgent(
                `Give me a concise daily priority summary for my open items:\n${
                  summaryLines || 'No open items logged yet.'
                }`
              );
            }}
            className="rounded-full bg-[#1F1F1F] dark:bg-[#E3E3E3] px-4 py-2 text-xs font-medium text-white dark:text-[#131314] hover:opacity-90 transition-opacity whitespace-nowrap shrink-0"
          >
            Generate Daily Summary
          </button>
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          {/* Orders, Support & To-Do Tracker */}
          <div className="lg:col-span-7 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-sm font-semibold text-[#1F1F1F] dark:text-[#E3E3E3]">
                Orders, Support &amp; To-Dos
              </h2>
              <div
                className="flex max-w-full overflow-x-auto items-center gap-1 rounded-full bg-[#F0F4F9] dark:bg-[#1E1F20] p-1"
                role="tablist"
                aria-label="Filter workspace"
              >
                {(['All', ...WORKSPACES] as const).map((w) => (
                  <button
                    key={w}
                    type="button"
                    role="tab"
                    aria-selected={filterWorkspace === w}
                    onClick={() => setFilterWorkspace(w)}
                    className={`rounded-full px-3 py-1 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                      filterWorkspace === w
                        ? 'bg-white dark:bg-[#282A2C] text-[#1F1F1F] dark:text-[#E3E3E3] shadow-sm'
                        : 'text-[#5F6368] dark:text-[#9AA0A6] hover:text-[#1F1F1F] dark:hover:text-[#E3E3E3]'
                    }`}
                  >
                    {w}
                  </button>
                ))}
              </div>
            </div>

            {/* Add Task Form */}
            <form
              onSubmit={handleTaskSubmit}
              className="rounded-2xl border border-[#E1E5EA] dark:border-[#333537] bg-[#F8FAFD] dark:bg-[#1E1F20] p-5 space-y-3"
            >
              <div className="text-xs font-semibold text-[#444746] dark:text-[#C4C7C5]">
                Log New Order / Support Item
              </div>
              {taskFormError && (
                <p className="text-xs font-medium text-[#C5221F] dark:text-[#F28B82]" role="alert">
                  {taskFormError}
                </p>
              )}

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div>
                  <label
                    htmlFor="task-workspace"
                    className="block text-xs text-[#5F6368] dark:text-[#9AA0A6] mb-1"
                  >
                    Workspace
                  </label>
                  <select
                    id="task-workspace"
                    value={workspace}
                    onChange={(e) => setWorkspace(e.target.value as WorkspaceCategory)}
                    className={inputClass}
                  >
                    {WORKSPACES.map((w) => (
                      <option key={w} value={w}>
                        {w}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label
                    htmlFor="task-category"
                    className="block text-xs text-[#5F6368] dark:text-[#9AA0A6] mb-1"
                  >
                    Category
                  </label>
                  <select
                    id="task-category"
                    value={category}
                    onChange={(e) => setCategory(e.target.value as BusinessTask['category'])}
                    className={inputClass}
                  >
                    <option value="Order">Order</option>
                    <option value="Support">Support</option>
                    <option value="Invoice">Invoice</option>
                    <option value="Marketing">Marketing</option>
                    <option value="To-Do">To-Do</option>
                  </select>
                </div>
                <div>
                  <label
                    htmlFor="task-lang"
                    className="block text-xs text-[#5F6368] dark:text-[#9AA0A6] mb-1"
                  >
                    Customer Language
                  </label>
                  <select
                    id="task-lang"
                    value={language}
                    onChange={(e) =>
                      setLanguage(e.target.value as 'English' | 'Hindi' | 'Gujarati')
                    }
                    className={inputClass}
                  >
                    <option value="English">English</option>
                    <option value="Hindi">Hindi</option>
                    <option value="Gujarati">Gujarati</option>
                  </select>
                </div>
              </div>

              <div>
                <label
                  htmlFor="task-title"
                  className="block text-xs text-[#5F6368] dark:text-[#9AA0A6] mb-1"
                >
                  Title
                </label>
                <input
                  id="task-title"
                  type="text"
                  value={title}
                  onChange={(e) => {
                    setTitle(e.target.value);
                    if (taskFormError) setTaskFormError(null);
                  }}
                  placeholder="e.g. Confirm client order delivery / Verify SSL certificate renewal"
                  className="w-full rounded-xl border border-[#DDE3EA] dark:border-[#3C4043] bg-white dark:bg-[#131314] px-3 py-2 text-sm text-[#1F1F1F] dark:text-[#E3E3E3] focus:border-[#1A73E8] focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div>
                  <label
                    htmlFor="task-customer"
                    className="block text-xs text-[#5F6368] dark:text-[#9AA0A6] mb-1"
                  >
                    Customer Name
                  </label>
                  <input
                    id="task-customer"
                    type="text"
                    value={customerName}
                    onChange={(e) => setCustomerName(e.target.value)}
                    placeholder="Optional"
                    className={inputClass}
                  />
                </div>
                <div>
                  <label
                    htmlFor="task-email"
                    className="block text-xs text-[#5F6368] dark:text-[#9AA0A6] mb-1"
                  >
                    Customer Email
                  </label>
                  <input
                    id="task-email"
                    type="email"
                    value={customerEmail}
                    onChange={(e) => setCustomerEmail(e.target.value)}
                    placeholder="Optional"
                    className={inputClass}
                  />
                </div>
                <div>
                  <label
                    htmlFor="task-amount"
                    className="block text-xs text-[#5F6368] dark:text-[#9AA0A6] mb-1"
                  >
                    Amount (INR)
                  </label>
                  <input
                    id="task-amount"
                    type="number"
                    min="0"
                    step="0.01"
                    value={amountInput}
                    onChange={(e) => setAmountInput(e.target.value)}
                    placeholder="Leave blank if TBD"
                    className={`${inputClass} font-mono tabular-nums`}
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div>
                  <label
                    htmlFor="task-due"
                    className="block text-xs text-[#5F6368] dark:text-[#9AA0A6] mb-1"
                  >
                    Due Date
                  </label>
                  <input
                    id="task-due"
                    type="date"
                    value={dueDate}
                    onChange={(e) => setDueDate(e.target.value)}
                    className={`${inputClass} font-mono`}
                  />
                </div>
                <div className="sm:col-span-2">
                  <label
                    htmlFor="task-notes"
                    className="block text-xs text-[#5F6368] dark:text-[#9AA0A6] mb-1"
                  >
                    Notes
                  </label>
                  <input
                    id="task-notes"
                    type="text"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Delivery slot, domain name, or invoice reference"
                    className={inputClass}
                  />
                </div>
              </div>

              <div>
                <button
                  type="submit"
                  className="inline-flex items-center gap-1.5 rounded-full bg-[#1A73E8] dark:bg-[#8AB4F8] px-4 py-2 text-xs font-medium text-white dark:text-[#041E49] hover:bg-[#1557B0] transition-colors whitespace-nowrap shrink-0"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Add Item
                </button>
              </div>
            </form>

            {/* Task List */}
            <div className="rounded-2xl border border-[#E1E5EA] dark:border-[#333537] bg-white dark:bg-[#1E1F20] divide-y divide-[#E1E5EA] dark:divide-[#2E3033] overflow-hidden">
              {visibleTasks.length === 0 ? (
                <div className="p-6 text-center text-xs text-[#5F6368] dark:text-[#9AA0A6]">
                  No items logged under {filterWorkspace} yet. Add your first order, support ticket,
                  or to-do above.
                </div>
              ) : (
                visibleTasks.map((task) => {
                  const StatusIcon =
                    task.status === 'done'
                      ? CheckCircle2
                      : task.status === 'in_progress'
                        ? Clock
                        : Circle;
                  const statusColor =
                    task.status === 'done'
                      ? 'text-[#188038] dark:text-[#81C995]'
                      : task.status === 'in_progress'
                        ? 'text-[#EA8600] dark:text-[#FDD663]'
                        : 'text-[#5F6368] dark:text-[#9AA0A6]';

                  return (
                    <div key={task.id} className="flex items-start justify-between gap-3 p-4">
                      <div className="flex items-start gap-3 min-w-0">
                        <button
                          type="button"
                          onClick={() => onCycleTaskStatus(task.id)}
                          aria-label={`Cycle status for ${task.title}`}
                          className={`mt-0.5 shrink-0 ${statusColor} hover:opacity-80`}
                        >
                          <StatusIcon className="h-4 w-4" />
                        </button>
                        <div className="min-w-0 space-y-1">
                          <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-[#5F6368] dark:text-[#9AA0A6]">
                            <span className="font-medium text-[#444746] dark:text-[#C4C7C5]">
                              {task.workspace}
                            </span>
                            <span aria-hidden="true">·</span>
                            <span>{task.category}</span>
                            {task.language && (
                              <>
                                <span aria-hidden="true">·</span>
                                <span>{task.language}</span>
                              </>
                            )}
                            {task.dueDate && (
                              <>
                                <span aria-hidden="true">·</span>
                                <span className="font-mono tabular-nums">Due {task.dueDate}</span>
                              </>
                            )}
                          </div>
                          <div
                            className={`text-sm font-semibold ${
                              task.status === 'done'
                                ? 'line-through text-[#8E918F]'
                                : 'text-[#1F1F1F] dark:text-[#E3E3E3]'
                            }`}
                          >
                            {task.title}
                          </div>
                          {(task.customerName || task.notes) && (
                            <div className="text-xs text-[#5F6368] dark:text-[#9AA0A6]">
                              {task.customerName ? `${task.customerName}` : ''}
                              {task.customerName && task.notes ? ' — ' : ''}
                              {task.notes}
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="flex flex-col items-end gap-2 shrink-0">
                        {task.amountInr != null && (
                          <span className="font-mono text-xs font-semibold tabular-nums text-[#1F1F1F] dark:text-[#E3E3E3]">
                            {formatInr(task.amountInr)}
                          </span>
                        )}
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() =>
                              onSendToAgent(
                                `Draft a ${task.language || 'English'} customer email for ${task.workspace} regarding "${task.title}".${
                                  task.customerName ? ` Customer: ${task.customerName}.` : ''
                                }${task.customerEmail ? ` Email: ${task.customerEmail}.` : ''}${
                                  task.amountInr != null
                                    ? ` Confirmed amount: ₹${task.amountInr}.`
                                    : ' Do not guess any price or date.'
                                }${task.notes ? ` Notes: ${task.notes}.` : ''} Queue it as a Gmail draft if recipient email is present.`
                              )
                            }
                            aria-label={`Draft reply for ${task.title}`}
                            className="inline-flex items-center gap-1 rounded-full border border-[#DDE3EA] dark:border-[#3C4043] bg-white dark:bg-[#282A2C] px-2.5 py-1 text-xs font-medium text-[#444746] dark:text-[#E3E3E3] hover:bg-[#F0F4F9] dark:hover:bg-[#333537] whitespace-nowrap shrink-0"
                          >
                            <Mail className="h-3 w-3" />
                            Draft
                          </button>
                          <button
                            type="button"
                            onClick={() => onRemoveTask(task.id)}
                            aria-label={`Remove ${task.title}`}
                            className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-[#E1E5EA] dark:border-[#3C4043] text-[#5F6368] dark:text-[#9AA0A6] hover:text-[#C5221F] hover:bg-[#FCE8E6] dark:hover:bg-[#3C1E1E]"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Exact Quote & Invoice Builder */}
          <div className="lg:col-span-5 space-y-4">
            <h2 className="text-sm font-semibold text-[#1F1F1F] dark:text-[#E3E3E3]">
              Exact Quote Builder
            </h2>
            <div className="rounded-2xl border border-[#E1E5EA] dark:border-[#333537] bg-[#F8FAFD] dark:bg-[#1E1F20] p-5 space-y-4">
              <p className="text-xs text-[#5F6368] dark:text-[#9AA0A6]">
                Numbers are calculated strictly from your inputs. Missing quantities or rates block
                totals instead of guessing.
              </p>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label
                    htmlFor="quote-workspace"
                    className="block text-xs text-[#5F6368] dark:text-[#9AA0A6] mb-1"
                  >
                    Workspace
                  </label>
                  <select
                    id="quote-workspace"
                    value={quoteWorkspace}
                    onChange={(e) => setQuoteWorkspace(e.target.value as WorkspaceCategory)}
                    className={inputClass}
                  >
                    {WORKSPACES.map((w) => (
                      <option key={w} value={w}>
                        {w}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label
                    htmlFor="quote-lang"
                    className="block text-xs text-[#5F6368] dark:text-[#9AA0A6] mb-1"
                  >
                    Email Language
                  </label>
                  <select
                    id="quote-lang"
                    value={quoteLang}
                    onChange={(e) =>
                      setQuoteLang(e.target.value as 'English' | 'Hindi' | 'Gujarati')
                    }
                    className={inputClass}
                  >
                    <option value="English">English</option>
                    <option value="Hindi">Hindi</option>
                    <option value="Gujarati">Gujarati</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label
                    htmlFor="quote-customer"
                    className="block text-xs text-[#5F6368] dark:text-[#9AA0A6] mb-1"
                  >
                    Customer Name
                  </label>
                  <input
                    id="quote-customer"
                    type="text"
                    value={quoteCustomer}
                    onChange={(e) => setQuoteCustomer(e.target.value)}
                    placeholder="e.g. Acme Corp"
                    className={inputClass}
                  />
                </div>
                <div>
                  <label
                    htmlFor="quote-email"
                    className="block text-xs text-[#5F6368] dark:text-[#9AA0A6] mb-1"
                  >
                    Customer Email
                  </label>
                  <input
                    id="quote-email"
                    type="email"
                    value={quoteEmail}
                    onChange={(e) => setQuoteEmail(e.target.value)}
                    placeholder="client@example.com"
                    className={inputClass}
                  />
                </div>
              </div>

              <div className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-[#444746] dark:text-[#C4C7C5]">
                    Line Items
                  </span>
                  <button
                    type="button"
                    onClick={handleAddLineItem}
                    className="text-xs font-medium text-[#1A73E8] dark:text-[#8AB4F8] hover:underline"
                  >
                    + Add row
                  </button>
                </div>

                {safeLineItems.map((item, idx) => (
                  <div
                    key={item.id}
                    className="space-y-2 rounded-xl border border-[#E1E5EA] dark:border-[#2E3033] bg-white dark:bg-[#131314]/60 p-3"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <input
                        type="text"
                        aria-label={`Line item ${idx + 1} description`}
                        value={item.description}
                        onChange={(e) =>
                          handleUpdateLineItem(item.id, 'description', e.target.value)
                        }
                        placeholder="Item description"
                        className="flex-1 rounded-lg border border-[#DDE3EA] dark:border-[#3C4043] bg-white dark:bg-[#1E1F20] px-2.5 py-1.5 text-xs text-[#1F1F1F] dark:text-[#E3E3E3]"
                      />
                      {safeLineItems.length > 1 && (
                        <button
                          type="button"
                          onClick={() =>
                            setLineItems((prev) =>
                              (Array.isArray(prev) ? prev : []).filter((row) => row.id !== item.id)
                            )
                          }
                          aria-label={`Remove line item ${idx + 1}`}
                          className="text-xs text-[#5F6368] dark:text-[#9AA0A6] hover:text-[#C5221F]"
                        >
                          Remove
                        </button>
                      )}
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label
                          htmlFor={`quote-qty-${item.id}`}
                          className="block text-[11px] text-[#5F6368] dark:text-[#9AA0A6] mb-0.5"
                        >
                          Quantity
                        </label>
                        <input
                          id={`quote-qty-${item.id}`}
                          type="number"
                          min="1"
                          value={item.quantity}
                          onChange={(e) =>
                            handleUpdateLineItem(item.id, 'quantity', e.target.value)
                          }
                          className="w-full rounded-lg border border-[#DDE3EA] dark:border-[#3C4043] bg-white dark:bg-[#1E1F20] px-2 py-1 text-xs font-mono tabular-nums text-[#1F1F1F] dark:text-[#E3E3E3]"
                        />
                      </div>
                      <div>
                        <label
                          htmlFor={`quote-price-${item.id}`}
                          className="block text-[11px] text-[#5F6368] dark:text-[#9AA0A6] mb-0.5"
                        >
                          Unit Price (₹)
                        </label>
                        <input
                          id={`quote-price-${item.id}`}
                          type="number"
                          min="0"
                          step="0.01"
                          value={item.unitPriceInr}
                          onChange={(e) =>
                            handleUpdateLineItem(item.id, 'unitPriceInr', e.target.value)
                          }
                          className="w-full rounded-lg border border-[#DDE3EA] dark:border-[#3C4043] bg-white dark:bg-[#1E1F20] px-2 py-1 text-xs font-mono tabular-nums text-[#1F1F1F] dark:text-[#E3E3E3]"
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <div className="flex items-center justify-between border-t border-[#E1E5EA] dark:border-[#2E3033] pt-3">
                <label
                  htmlFor="quote-gst"
                  className="text-xs font-medium text-[#444746] dark:text-[#C4C7C5]"
                >
                  Tax / GST (%)
                </label>
                <select
                  id="quote-gst"
                  value={gstPercent}
                  onChange={(e) => setGstPercent(Number(e.target.value))}
                  className="rounded-lg border border-[#DDE3EA] dark:border-[#3C4043] bg-white dark:bg-[#131314] px-2.5 py-1 text-xs font-mono tabular-nums text-[#1F1F1F] dark:text-[#E3E3E3]"
                >
                  <option value={0}>0%</option>
                  <option value={5}>5%</option>
                  <option value={12}>12%</option>
                  <option value={18}>18%</option>
                </select>
              </div>

              {!quoteCalc.valid ? (
                <div className="rounded-xl border border-[#FDE293] dark:border-[#5C4400] bg-[#FEF7E0] dark:bg-[#332700] p-3 text-xs text-[#7A4F01] dark:text-[#FDD663]">
                  Missing required quote values: {(quoteCalc.missingFields ?? []).join(', ')}.
                </div>
              ) : (
                <dl className="space-y-1.5 border-t border-[#E1E5EA] dark:border-[#2E3033] pt-3 text-xs">
                  <div className="flex justify-between text-[#5F6368] dark:text-[#9AA0A6]">
                    <dt>Subtotal</dt>
                    <dd className="font-mono tabular-nums">{formatInr(quoteCalc.subtotalInr)}</dd>
                  </div>
                  <div className="flex justify-between text-[#5F6368] dark:text-[#9AA0A6]">
                    <dt>Tax / GST ({gstPercent}%)</dt>
                    <dd className="font-mono tabular-nums">{formatInr(quoteCalc.gstAmountInr)}</dd>
                  </div>
                  <div className="flex justify-between border-t border-[#E1E5EA] dark:border-[#2E3033] pt-2 text-sm font-semibold text-[#1F1F1F] dark:text-[#E3E3E3]">
                    <dt>Total</dt>
                    <dd className="font-mono tabular-nums">{formatInr(quoteCalc.totalInr)}</dd>
                  </div>
                </dl>
              )}

              <button
                type="button"
                disabled={!quoteCalc.valid}
                onClick={handleSendQuoteToAgent}
                className="w-full rounded-full bg-[#1A73E8] dark:bg-[#8AB4F8] px-4 py-2.5 text-xs font-medium text-white dark:text-[#041E49] hover:bg-[#1557B0] disabled:opacity-50 transition-colors"
              >
                Send Verified Quote to IND AGENT
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
