import { useState } from 'react';
import {
  Briefcase,
  Code2,
  Pencil,
  Plus,
  Sparkles,
  Trash2,
  Wand2,
  X,
} from 'lucide-react';
import {
  MAX_SKILL_INSTRUCTIONS_CHARS,
  validateCustomSkillInput,
} from '../utils/skillsEngine';
import type { AgentMode, SkillDefinition } from '../types/agent';

interface SkillsModalProps {
  open: boolean;
  skills: SkillDefinition[];
  isCloudSynced: boolean;
  onClose: () => void;
  onUseSkill: (skill: SkillDefinition) => void;
  onSaveCustomSkill: (skill: Omit<SkillDefinition, 'id' | 'builtIn'>, editingId?: string) => Promise<void>;
  onDeleteCustomSkill: (skillId: string) => Promise<void>;
}

const MODE_LABELS: Record<AgentMode, string> = {
  auto: 'Auto',
  coding: 'Coding',
  business: 'Business',
};

export function SkillsModal({
  open,
  skills,
  isCloudSynced,
  onClose,
  onUseSkill,
  onSaveCustomSkill,
  onDeleteCustomSkill,
}: SkillsModalProps) {
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | undefined>(undefined);
  const [command, setCommand] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [mode, setMode] = useState<AgentMode>('auto');
  const [placeholder, setPlaceholder] = useState('');
  const [instructions, setInstructions] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  if (!open) return null;

  const defaultSkills = skills.filter((s) => s.builtIn);
  const customSkills = skills.filter((s) => !s.builtIn);

  const resetForm = () => {
    setFormOpen(false);
    setEditingId(undefined);
    setCommand('');
    setName('');
    setDescription('');
    setMode('auto');
    setPlaceholder('');
    setInstructions('');
    setError(null);
  };

  const openEditForm = (skill: SkillDefinition) => {
    setEditingId(skill.id);
    setCommand(skill.command);
    setName(skill.name);
    setDescription(skill.description);
    setMode(skill.mode);
    setPlaceholder(skill.placeholder ?? '');
    setInstructions(skill.instructions);
    setError(null);
    setFormOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const check = validateCustomSkillInput(
      { command, name, description, mode, instructions, placeholder },
      skills,
      editingId
    );
    if (!check.ok) {
      setError(check.error);
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await onSaveCustomSkill(check.normalized, editingId);
      resetForm();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save custom skill.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-[2px] p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Skills Manager"
    >
      <div className="flex max-h-[88vh] w-full max-w-3xl flex-col rounded-2xl border border-[#DDE3EA] dark:border-[#333537] bg-white dark:bg-[#1E1F20] shadow-2xl overflow-hidden">
        {/* Modal Header */}
        <div className="flex items-center justify-between gap-3 border-b border-[#E1E5EA] dark:border-[#2E3033] px-6 py-4">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#E8F0FE] dark:bg-[#004A77]/60 text-[#1A73E8] dark:text-[#8AB4F8]">
              <Wand2 className="h-4.5 w-4.5" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <h2 className="text-base font-semibold text-[#1F1F1F] dark:text-[#E3E3E3]">
                Skills
              </h2>
              <p className="text-xs text-[#5F6368] dark:text-[#9AA0A6]">
                Type <code className="font-mono text-[#1A73E8] dark:text-[#8AB4F8]">/</code> in the
                prompt bar to run any skill ·{' '}
                {isCloudSynced ? 'Synced to your Google account' : 'Saved locally (Sign in to sync)'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {!formOpen && (
              <button
                type="button"
                onClick={() => {
                  resetForm();
                  setFormOpen(true);
                }}
                className="inline-flex items-center gap-1.5 rounded-full bg-[#1A73E8] px-3.5 py-1.5 text-xs font-medium text-white hover:bg-[#1557B0] transition-colors whitespace-nowrap"
              >
                <Plus className="h-3.5 w-3.5" />
                New Skill
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              aria-label="Close Skills Manager"
              className="inline-flex h-8 w-8 items-center justify-center rounded-full text-[#5F6368] hover:bg-[#F0F4F9] dark:hover:bg-[#282A2C] hover:text-[#1F1F1F] dark:hover:text-white"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
          {/* Create / Edit Custom Skill Form */}
          {formOpen && (
            <form
              onSubmit={handleSubmit}
              className="rounded-2xl border border-[#C2D4EE] dark:border-[#004A77] bg-[#F8FAFD] dark:bg-[#131314] p-5 space-y-4"
            >
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-[#1F1F1F] dark:text-[#E3E3E3]">
                  {editingId ? 'Edit Custom Skill' : 'Create Custom Skill'}
                </h3>
                <button
                  type="button"
                  onClick={resetForm}
                  className="text-xs font-medium text-[#5F6368] hover:text-[#1F1F1F] dark:hover:text-white"
                >
                  Cancel
                </button>
              </div>

              {error && (
                <p
                  role="alert"
                  className="rounded-xl border border-[#F5C2C0] bg-[#FCE8E6]/70 dark:bg-[#3B1E1D] px-3 py-2 text-xs text-[#A50E0E] dark:text-[#F6AEA9]"
                >
                  {error}
                </p>
              )}

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div>
                  <label
                    htmlFor="skill-command"
                    className="block text-xs font-medium text-[#444746] dark:text-[#C4C7C5] mb-1"
                  >
                    Slash Command
                  </label>
                  <input
                    id="skill-command"
                    type="text"
                    value={command}
                    onChange={(e) => setCommand(e.target.value)}
                    placeholder="/sql"
                    maxLength={24}
                    className="w-full rounded-xl border border-[#DDE3EA] dark:border-[#3C4043] bg-white dark:bg-[#1E1F20] px-3 py-2 font-mono text-xs text-[#1F1F1F] dark:text-[#E3E3E3] focus:border-[#1A73E8] focus:outline-none"
                  />
                </div>
                <div>
                  <label
                    htmlFor="skill-name"
                    className="block text-xs font-medium text-[#444746] dark:text-[#C4C7C5] mb-1"
                  >
                    Skill Name
                  </label>
                  <input
                    id="skill-name"
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="SQL Query Optimizer"
                    maxLength={60}
                    className="w-full rounded-xl border border-[#DDE3EA] dark:border-[#3C4043] bg-white dark:bg-[#1E1F20] px-3 py-2 text-xs text-[#1F1F1F] dark:text-[#E3E3E3] focus:border-[#1A73E8] focus:outline-none"
                  />
                </div>
                <div>
                  <label
                    htmlFor="skill-mode"
                    className="block text-xs font-medium text-[#444746] dark:text-[#C4C7C5] mb-1"
                  >
                    Default Mode
                  </label>
                  <select
                    id="skill-mode"
                    value={mode}
                    onChange={(e) => setMode(e.target.value as AgentMode)}
                    className="w-full rounded-xl border border-[#DDE3EA] dark:border-[#3C4043] bg-white dark:bg-[#1E1F20] px-3 py-2 text-xs text-[#1F1F1F] dark:text-[#E3E3E3] focus:border-[#1A73E8] focus:outline-none"
                  >
                    <option value="auto">Auto</option>
                    <option value="coding">Coding</option>
                    <option value="business">Business</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label
                    htmlFor="skill-desc"
                    className="block text-xs font-medium text-[#444746] dark:text-[#C4C7C5] mb-1"
                  >
                    Short Description
                  </label>
                  <input
                    id="skill-desc"
                    type="text"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Rewrites slow SQL queries with indexes and EXPLAIN guidance."
                    maxLength={180}
                    className="w-full rounded-xl border border-[#DDE3EA] dark:border-[#3C4043] bg-white dark:bg-[#1E1F20] px-3 py-2 text-xs text-[#1F1F1F] dark:text-[#E3E3E3] focus:border-[#1A73E8] focus:outline-none"
                  />
                </div>
                <div>
                  <label
                    htmlFor="skill-placeholder"
                    className="block text-xs font-medium text-[#444746] dark:text-[#C4C7C5] mb-1"
                  >
                    Example Hint (Optional)
                  </label>
                  <input
                    id="skill-placeholder"
                    type="text"
                    value={placeholder}
                    onChange={(e) => setPlaceholder(e.target.value)}
                    placeholder="e.g. paste your PostgreSQL SELECT query"
                    maxLength={160}
                    className="w-full rounded-xl border border-[#DDE3EA] dark:border-[#3C4043] bg-white dark:bg-[#1E1F20] px-3 py-2 text-xs text-[#1F1F1F] dark:text-[#E3E3E3] focus:border-[#1A73E8] focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label
                    htmlFor="skill-instructions"
                    className="text-xs font-medium text-[#444746] dark:text-[#C4C7C5]"
                  >
                    Skill Prompt Instructions
                  </label>
                  <span className="font-mono text-[11px] tabular-nums text-[#5F6368] dark:text-[#9AA0A6]">
                    {instructions.length} / {MAX_SKILL_INSTRUCTIONS_CHARS}
                  </span>
                </div>
                <textarea
                  id="skill-instructions"
                  rows={4}
                  value={instructions}
                  onChange={(e) => setInstructions(e.target.value)}
                  maxLength={MAX_SKILL_INSTRUCTIONS_CHARS}
                  placeholder="Tell IND AGENT exactly how to handle requests invoked with this skill..."
                  className="w-full rounded-xl border border-[#DDE3EA] dark:border-[#3C4043] bg-white dark:bg-[#1E1F20] px-3 py-2 text-xs leading-relaxed text-[#1F1F1F] dark:text-[#E3E3E3] focus:border-[#1A73E8] focus:outline-none"
                />
              </div>

              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={resetForm}
                  className="rounded-full border border-[#DDE3EA] dark:border-[#3C4043] px-4 py-1.5 text-xs font-medium text-[#444746] dark:text-[#C4C7C5] hover:bg-[#F0F4F9] dark:hover:bg-[#282A2C]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-full bg-[#1A73E8] px-4 py-1.5 text-xs font-medium text-white hover:bg-[#1557B0] disabled:opacity-50"
                >
                  {saving ? 'Saving...' : editingId ? 'Save Changes' : 'Create Skill'}
                </button>
              </div>
            </form>
          )}

          {/* Default Built-in Skills */}
          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-[#5F6368] dark:text-[#9AA0A6]">
                Default Skills ({defaultSkills.length})
              </h3>
            </div>
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              {defaultSkills.map((skill) => (
                <div
                  key={skill.id}
                  className="flex flex-col justify-between rounded-2xl border border-[#E8EDF4] dark:border-[#2E3033] bg-[#F8FAFD] dark:bg-[#131314] p-4 space-y-3"
                >
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <code className="rounded-lg bg-[#E8F0FE] dark:bg-[#004A77]/60 px-2 py-0.5 font-mono text-xs font-semibold text-[#1A73E8] dark:text-[#C2E7FF]">
                          {skill.command}
                        </code>
                        <span className="truncate text-sm font-semibold text-[#1F1F1F] dark:text-[#E3E3E3]">
                          {skill.name}
                        </span>
                      </div>
                      <span className="inline-flex items-center gap-1 text-[11px] font-medium text-[#5F6368] dark:text-[#9AA0A6] shrink-0">
                        {skill.mode === 'coding' ? (
                          <Code2 className="h-3 w-3" />
                        ) : skill.mode === 'business' ? (
                          <Briefcase className="h-3 w-3" />
                        ) : (
                          <Sparkles className="h-3 w-3" />
                        )}
                        {MODE_LABELS[skill.mode]}
                      </span>
                    </div>
                    <p className="text-xs leading-relaxed text-[#5F6368] dark:text-[#9AA0A6]">
                      {skill.description}
                    </p>
                  </div>
                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={() => {
                        onUseSkill(skill);
                        onClose();
                      }}
                      className="rounded-full border border-[#DDE3EA] dark:border-[#3C4043] bg-white dark:bg-[#1E1F20] px-3 py-1 text-xs font-medium text-[#1A73E8] dark:text-[#8AB4F8] hover:bg-[#E8F0FE] dark:hover:bg-[#004A77]/40 transition-colors"
                    >
                      Use {skill.command}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Custom User Skills */}
          <div className="space-y-2.5">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-[#5F6368] dark:text-[#9AA0A6]">
              Your Custom Skills ({customSkills.length})
            </h3>
            {customSkills.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-[#DDE3EA] dark:border-[#3C4043] p-5 text-center space-y-2">
                <p className="text-xs text-[#5F6368] dark:text-[#9AA0A6]">
                  No custom skills yet. Create reusable slash commands like{' '}
                  <code className="font-mono">/sql</code>, <code className="font-mono">/react</code>,
                  or <code className="font-mono">/pitch</code>.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    resetForm();
                    setFormOpen(true);
                  }}
                  className="inline-flex items-center gap-1.5 rounded-full border border-[#DDE3EA] dark:border-[#3C4043] bg-white dark:bg-[#282A2C] px-3.5 py-1.5 text-xs font-medium text-[#1F1F1F] dark:text-[#E3E3E3] hover:bg-[#F0F4F9] dark:hover:bg-[#333537]"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Create Custom Skill
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                {customSkills.map((skill) => (
                  <div
                    key={skill.id}
                    className="flex flex-col justify-between rounded-2xl border border-[#E8EDF4] dark:border-[#2E3033] bg-[#F8FAFD] dark:bg-[#131314] p-4 space-y-3"
                  >
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <code className="rounded-lg bg-[#E6F4EA] dark:bg-[#0F5132]/50 px-2 py-0.5 font-mono text-xs font-semibold text-[#137333] dark:text-[#81C995]">
                            {skill.command}
                          </code>
                          <span className="truncate text-sm font-semibold text-[#1F1F1F] dark:text-[#E3E3E3]">
                            {skill.name}
                          </span>
                        </div>
                        <span className="text-[11px] font-medium text-[#5F6368] dark:text-[#9AA0A6] shrink-0">
                          {MODE_LABELS[skill.mode]}
                        </span>
                      </div>
                      <p className="text-xs leading-relaxed text-[#5F6368] dark:text-[#9AA0A6]">
                        {skill.description}
                      </p>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => openEditForm(skill)}
                          aria-label={`Edit skill ${skill.command}`}
                          className="inline-flex h-7 w-7 items-center justify-center rounded-full text-[#5F6368] hover:bg-[#E1E5EA] dark:hover:bg-[#282A2C] hover:text-[#1F1F1F] dark:hover:text-white"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => void onDeleteCustomSkill(skill.id)}
                          aria-label={`Delete skill ${skill.command}`}
                          className="inline-flex h-7 w-7 items-center justify-center rounded-full text-[#5F6368] hover:bg-[#FCE8E6] dark:hover:bg-[#3B1E1D] hover:text-[#D93025]"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          onUseSkill(skill);
                          onClose();
                        }}
                        className="rounded-full border border-[#DDE3EA] dark:border-[#3C4043] bg-white dark:bg-[#1E1F20] px-3 py-1 text-xs font-medium text-[#1A73E8] dark:text-[#8AB4F8] hover:bg-[#E8F0FE] dark:hover:bg-[#004A77]/40 transition-colors"
                      >
                        Use {skill.command}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
