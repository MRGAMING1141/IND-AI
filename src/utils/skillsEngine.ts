import type { AgentMode, SkillDefinition } from '../types/agent';

export const MAX_CUSTOM_INSTRUCTIONS_CHARS = 1500;
export const MAX_SKILL_INSTRUCTIONS_CHARS = 2000;
export const SKILL_COMMAND_REGEX = /^\/[a-z][a-z0-9_-]{1,22}$/;

export const DEFAULT_SKILLS: SkillDefinition[] = [
  {
    id: 'builtin_prompt',
    command: '/prompt',
    name: 'Make Prompt',
    description:
      'Transforms a rough idea into a high-precision, copy-ready prompt with role, constraints, output format, and edge cases.',
    mode: 'auto',
    builtIn: true,
    isPromptEngineer: true,
    placeholder: 'e.g. build a multi-tenant SaaS invoice tracker in Next.js',
    instructions:
      'You are acting as a Principal Prompt Architect. Do NOT execute or code the underlying task directly unless the user asks — instead, craft a complete, crystal-clear, frontier-grade engineered prompt that the user can copy-paste into any AI model. Structure the response with: (1) Brief Strategy Note (2 bullets max), (2) a single clean ```prompt:Engineered Prompt fenced block containing Role, Objective, Context & Assumptions, Functional Requirements, Non-Functional Constraints, Edge Cases, and Exact Output Format, and (3) 2-3 optional Power-Up Variables the user can tweak.',
  },
  {
    id: 'builtin_luau',
    command: '/luau',
    name: 'Roblox Luau Architect',
    description:
      'Builds complete, OOP Roblox Luau modules or UI libraries with TweenService animations, Maid cleanup, and a runnable DemoUsage.luau.',
    mode: 'coding',
    builtIn: true,
    forceDebugLoop: true,
    placeholder: 'e.g. draggable dark/light UI library with tabs, sliders, keybinds & toasts',
    instructions:
      'Build a flagship, production-grade Roblox Luau implementation in clean OOP style. Include strict Roblox-safe APIs (TweenService, UserInputService, Players.LocalPlayer, HttpService), full RBXScriptConnection cleanup via a Maid/Destroy pattern, zero stubs or TODOs, and a second clearly labeled ```luau:DemoUsage.luau file showing every public method in action.',
  },
  {
    id: 'builtin_email',
    command: '/email',
    name: 'Business Email Drafter',
    description:
      'Drafts polished customer or client emails in English, Hindi, or Gujarati inside a ready-to-queue Gmail draft block.',
    mode: 'business',
    builtIn: true,
    placeholder: 'e.g. polite payment reminder to rahul@acme.in for invoice #408 (₹18,500)',
    instructions:
      'Draft a clear, courteous, high-converting business email matching the requested language (default English, or Hindi / Gujarati if requested). Always output the email inside a ```draft fenced block with To:, Subject:, Language:, and complete body. Never guess missing amounts or dates — mark missing fields cleanly in [brackets]. If Gmail is connected and recipient is given, also call propose_gmail_draft so the user can review before saving.',
  },
  {
    id: 'builtin_debug',
    command: '/debug',
    name: 'Root-Cause Debugger',
    description:
      'Pinpoints the exact root cause of a bug or crash, verifies the fix in the sandbox loop, and returns complete fixed code.',
    mode: 'coding',
    builtIn: true,
    forceDebugLoop: true,
    placeholder: 'e.g. paste error stack trace or broken function here',
    instructions:
      'Perform deep root-cause debugging. First state (1) Exact Root Cause (line/symbol/condition and why it fails) in 1-3 crisp lines, (2) verify the fix using verify_code_snippet with edge-case assertions whenever pure JS/TS logic is involved, and (3) return the COMPLETE fixed code (never partial "...rest unchanged..." snippets) plus a brief Regression Checklist.',
  },
  {
    id: 'builtin_audit',
    command: '/audit',
    name: 'Code, Security & UX Audit',
    description:
      'Audits code or architecture for security flaws, performance bottlenecks, edge cases, and responsive UX issues with patched code.',
    mode: 'coding',
    builtIn: true,
    placeholder: 'e.g. paste code or describe your API/UI to audit',
    instructions:
      'Perform a rigorous principal-engineer audit covering Security (XSS, injection, auth/access control, secrets), Correctness & Edge Cases, Performance, and Responsive UX/Accessibility. Present findings in a Markdown Severity Table (Severity | Area | Issue | Concrete Fix), followed by the complete hardened/patched code if code was provided.',
  },
];

export function normalizeSkillCommand(raw: string): string {
  const cleaned = raw
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9_/-]/g, '');
  if (!cleaned) return '';
  return cleaned.startsWith('/') ? cleaned : `/${cleaned}`;
}

export function validateCustomSkillInput(
  input: {
    command: string;
    name: string;
    description: string;
    mode: AgentMode;
    instructions: string;
    placeholder?: string;
  },
  existingSkills: SkillDefinition[],
  editingId?: string
): { ok: true; normalized: Omit<SkillDefinition, 'id' | 'builtIn'> } | { ok: false; error: string } {
  const command = normalizeSkillCommand(input.command);
  if (!SKILL_COMMAND_REGEX.test(command)) {
    return {
      ok: false,
      error:
        'Command must start with / followed by 2–23 lowercase letters, numbers, hyphens, or underscores (e.g. /sql or /api-spec).',
    };
  }

  const duplicate = existingSkills.find(
    (s) => s.command.toLowerCase() === command && s.id !== editingId
  );
  if (duplicate) {
    return {
      ok: false,
      error: `Command ${command} is already used by "${duplicate.name}". Choose a different command.`,
    };
  }

  const name = input.name.trim();
  if (!name || name.length > 60) {
    return { ok: false, error: 'Skill name is required (1–60 characters).' };
  }

  const description = input.description.trim();
  if (!description || description.length > 180) {
    return { ok: false, error: 'Short description is required (1–180 characters).' };
  }

  const instructions = input.instructions.trim();
  if (!instructions || instructions.length > MAX_SKILL_INSTRUCTIONS_CHARS) {
    return {
      ok: false,
      error: `Skill instructions are required (1–${MAX_SKILL_INSTRUCTIONS_CHARS} characters).`,
    };
  }

  const placeholder = input.placeholder?.trim().slice(0, 160) || undefined;
  const mode: AgentMode =
    input.mode === 'coding' || input.mode === 'business' ? input.mode : 'auto';

  return {
    ok: true,
    normalized: {
      command,
      name,
      description,
      mode,
      instructions,
      placeholder,
    },
  };
}

/**
 * Detects if the user is currently typing a slash skill token at the start of the composer.
 * Returns the lowercase query after `/` (e.g., "" for "/", "pr" for "/pr"), or null when closed.
 */
export function detectSlashQuery(input: string): string | null {
  if (!input.startsWith('/')) return null;
  // Close palette once user inserts whitespace after the command token
  if (/\s/.test(input)) return null;
  const token = input.slice(1).toLowerCase();
  if (/[^a-z0-9_-]/.test(token)) return null;
  return token;
}

export function filterSkills(skills: SkillDefinition[], query: string): SkillDefinition[] {
  const q = query.trim().toLowerCase();
  if (!q) return skills;
  return skills.filter(
    (s) =>
      s.command.slice(1).toLowerCase().includes(q) ||
      s.name.toLowerCase().includes(q) ||
      s.description.toLowerCase().includes(q)
  );
}

export interface ResolvedSkillInvocation {
  matchedSkill: SkillDefinition | null;
  displayContent: string;
  expandedPrompt: string;
  recommendedMode?: AgentMode;
  forceDebugLoop?: boolean;
  skipAutoCodeVerify?: boolean;
}

/**
 * Resolves a message like "/prompt build an invoice app" into the clean display message
 * and the expanded prompt sent to IND AGENT, while leaving normal messages untouched.
 */
export function resolveSkillInvocation(
  rawInput: string,
  skills: SkillDefinition[]
): ResolvedSkillInvocation {
  const trimmed = rawInput.trim();
  if (!trimmed.startsWith('/')) {
    return {
      matchedSkill: null,
      displayContent: trimmed,
      expandedPrompt: trimmed,
    };
  }

  const match = trimmed.match(/^(\/[a-zA-Z0-9_-]+)(?:\s+([\s\S]*))?$/);
  if (!match) {
    return {
      matchedSkill: null,
      displayContent: trimmed,
      expandedPrompt: trimmed,
    };
  }

  const cmd = match[1].toLowerCase();
  const userArgs = (match[2] ?? '').trim();
  const skill = skills.find((s) => s.command.toLowerCase() === cmd);

  if (!skill) {
    return {
      matchedSkill: null,
      displayContent: trimmed,
      expandedPrompt: trimmed,
    };
  }

  const taskText =
    userArgs ||
    `Apply the ${skill.name} skill cleanly (if details are missing, briefly ask or provide a strong template example).`;

  const expandedPrompt = `[ACTIVE SKILL: ${skill.command} — ${skill.name}]\nSkill Instructions:\n${skill.instructions}\n\nUser Request:\n${taskText}`;

  return {
    matchedSkill: skill,
    displayContent: trimmed,
    expandedPrompt,
    recommendedMode: skill.mode !== 'auto' ? skill.mode : undefined,
    forceDebugLoop: skill.forceDebugLoop,
    skipAutoCodeVerify: skill.isPromptEngineer,
  };
}

export function clampCustomInstructions(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw.trim().slice(0, MAX_CUSTOM_INSTRUCTIONS_CHARS);
}
