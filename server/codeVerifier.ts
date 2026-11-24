import vm from 'node:vm';
import { transformSync } from 'esbuild';
import type { AgentMode, ChatAttachment } from '../src/types/agent.ts';
import {
  HINGLISH_EDIT_FIX_RE,
  isPromptWritingRequest,
  normalizeUserPromptText,
} from './promptUnderstanding.ts';

export type PromptIntentKind =
  | 'build_app'
  | 'fix_bug'
  | 'refactor'
  | 'roblox_luau'
  | 'explain_code'
  | 'prompt_engineering'
  | 'business_ops'
  | 'general';

export interface CodingIntentAnalysis {
  kind: PromptIntentKind;
  isCodingTask: boolean;
  isDebuggingTask: boolean;
  isWebsiteOrFullStack: boolean;
  isHighLevelBuild: boolean;
  isLuaUiLibrary: boolean;
  languages: string[];
  wantsMultiFile: boolean;
  wantsBackend: boolean;
  summary: string;
}

export interface FollowUpCodeEditContext {
  isFollowUpEdit: boolean;
  previousFileNames: string[];
  previousLineCount: number;
  previousHasHtmlArtifact: boolean;
  wantsShrinkOrDelete: boolean;
  latestCodeBlocks: Array<{ language: string; fileName: string; code: string }>;
}

export interface CodeVerificationIssue {
  file: string;
  language: string;
  severity: 'error' | 'warning';
  line?: number;
  column?: number;
  message: string;
}

export interface CodeVerificationReport {
  filesChecked: number;
  passed: boolean;
  errorCount: number;
  warningCount: number;
  issues: CodeVerificationIssue[];
  summary: string;
}

export interface SandboxedJsCheckResult {
  syntaxOk: boolean;
  runtimeOk: boolean;
  logs: string[];
  returnValue?: string;
  error?: string;
  line?: number;
  column?: number;
}

const CODE_FILE_EXT_RE = /\.(html?|css|scss|js|jsx|mjs|cjs|ts|tsx|py|lua|luau|json|sql|sh|yml|yaml|xml)$/i;

export function analyzeCodingIntent(
  message: string,
  mode: AgentMode,
  attachments?: ChatAttachment[]
): CodingIntentAnalysis {
  const rawText = (message ?? '').trim();
  const text = normalizeUserPromptText(rawText);
  const lower = text.toLowerCase();
  const safeAtts = Array.isArray(attachments) ? attachments : [];
  const hasCodeAttachment = safeAtts.some((a) => CODE_FILE_EXT_RE.test(a?.name ?? ''));

  // CRITICAL: If user asked to WRITE / CRAFT A PROMPT (even about a website/app),
  // NEVER classify it as building a website or writing code!
  if (isPromptWritingRequest(text)) {
    return {
      kind: 'prompt_engineering',
      isCodingTask: false,
      isDebuggingTask: false,
      isWebsiteOrFullStack: false,
      isHighLevelBuild: false,
      isLuaUiLibrary: false,
      languages: [],
      wantsMultiFile: false,
      wantsBackend: false,
      summary: 'Crafting copy-ready prompt (text prompt only — not building code/website)',
    };
  }

  const languages: string[] = [];
  const addLang = (lang: string) => {
    if (!languages.includes(lang)) languages.push(lang);
  };

  if (/\b(roblox|luau|lua|leaderstats|remote\s*event|datastoreservice|startergui|screengui|tweenservice)\b/i.test(text)) {
    addLang('Luau');
  }
  if (/\b(typescript|tsx|\.ts\b|tsconfig)\b/i.test(text)) addLang('TypeScript');
  if (/\b(react|jsx|usestate|useeffect|next\.?js|tailwind)\b/i.test(text)) addLang('React');
  if (/\b(javascript|node\.?js|express|vanilla js|\.js\b)\b/i.test(text)) addLang('JavaScript');
  if (/\b(html|css|single[- ]file|webpage|website|site|landing\s*page|calculator|dashboard|ui)\b/i.test(text)) {
    addLang('HTML/CSS');
  }
  if (/\b(python|flask|fastapi|django|pandas|\.py\b)\b/i.test(text)) addLang('Python');
  if (/\b(sql|postgres|sqlite|mysql|query)\b/i.test(text)) addLang('SQL');
  if (/\b(json|api|webhook|fetch|regex)\b/i.test(text)) addLang('API/JSON');

  for (const att of safeAtts) {
    const n = (att?.name ?? '').toLowerCase();
    if (n.endsWith('.ts') || n.endsWith('.tsx')) addLang('TypeScript');
    else if (n.endsWith('.js') || n.endsWith('.jsx') || n.endsWith('.mjs')) addLang('JavaScript');
    else if (n.endsWith('.html') || n.endsWith('.htm')) addLang('HTML/CSS');
    else if (n.endsWith('.py')) addLang('Python');
    else if (n.endsWith('.lua') || n.endsWith('.luau')) addLang('Luau');
  }

  const hasStackTraceOrError =
    /\b(typeerror|referenceerror|syntaxerror|uncaught|stack\s*trace|cannot read properties|undefined is not|is not a function|nan|crash|bug|broken|error:|exception|traceback|failing|doesn'?t work|not working|debug|fix)\b/i.test(
      text
    ) || /\b(thik\s*karo|theek\s*karo|sahi\s*karo|kaam\s*nahi\s*kar\s*raha|nahi\s*chal\s*raha|fix\s*karo|fix\s*krdo)\b/i.test(rawText);

  const hasBuildKeywords =
    /\b(build|create|make|write|code|generate|implement|develop|script|app|website|site|tool|component|function|algorithm|game|calculator|converter|bot|scraper|server|endpoint|banao|bana\s*do|bna\s*do|bnao|taiyar\s*karo)\b/i.test(
      text
    );

  const hasRefactorKeywords =
    /\b(refactor|optimize|clean up|improve|rewrite|convert|migrate|upgrade|speed up)\b/i.test(text);

  const hasExplainKeywords =
    /\b(explain|how does|walk me through|what does this code|review this code|samjhao)\b/i.test(text);

  const hasBusinessKeywords =
    /\b(invoice|quote|quotation|gst|customer|client|gmail|email|reply|draft|order|hosting|pricing|marketing|summary|to-do|todo|whatsapp|hindi|gujarati)\b/i.test(
      text
    );

  const hasInlineCode = /```|function\s+\w+|const\s+\w+\s*=|def\s+\w+\(|<\w+[^>]*>/.test(text);
  const explicitSingleFile = /\bsingle[- ]file\b/i.test(text);
  const explicitTinyRequest =
    /\b(1[- ]?liner|one[- ]?liner|3[- ]?line|short snippet|tiny snippet|quick example|minimal example|simple function)\b/i.test(
      text
    );
  const isLuaUiLibrary =
    languages.includes('Luau') &&
    /\b(ui\s*lib|ui\s*library|gui\s*lib|gui\s*library|interface\s*lib|menu\s*lib|window\s*lib|hub\s*ui|component\s*lib)\b/i.test(
      text
    );
  const isWebsiteOrFullStack =
    !explicitSingleFile &&
    !languages.includes('Luau') &&
    /\b(portfolio|website|web\s*site|web\s*app|landing\s*page|full[- ]?stack|saas|dashboard|e-?commerce|online\s*store|shop|blog|agency\s*site|booking\s*site|crm|cms|marketplace|social\s*app|admin\s*panel|resume\s*site|(?:make|build|create|design|banao|bana\s*do|bnao)\s+(?:me\s+)?(?:a\s+|an\s+|ek\s+)?(?:[\w-]+\s+){0,3}(?:site|web|page|storefront|cafe|coffee\s*shop|restaurant|gym))\b/i.test(
      text
    );
  const isHighLevelBuild =
    !explicitTinyRequest &&
    (isWebsiteOrFullStack ||
      isLuaUiLibrary ||
      /\b(library|lib\b|framework|engine|system|sdk|platform|studio|dashboard|application|app\b|game|simulator|compiler|interpreter|parser|cli\s*tool|bot|admin\s*panel|inventory|combat|shop\s*system|data\s*store|state\s*manager|router|orm|server|api|editor|ide|builder|calculator|tracker|manager|high[- ]?level|full[- ]?fledged|advanced|complete|production)\b/i.test(
        text
      ));
  const wantsBackend =
    /\b(full[- ]?stack|backend|back[- ]?end|express|node\.?js\s*server|rest\s*api|api\s*server|database|sqlite|postgres|server\.js|crud\s*api)\b/i.test(
      text
    );
  const wantsMultiFile =
    wantsBackend ||
    /\b(multi[- ]file|project|zip|folder structure|separate files)\b/i.test(text);

  const isDebuggingTask =
    hasStackTraceOrError && (mode === 'coding' || hasInlineCode || hasCodeAttachment || languages.length > 0 || /\b(bug|debug|fix|error|crash|code|script|function|app|html|js|button|toggle|page|website|site|thik|kaam\s*nahi)\b/i.test(text));

  let kind: PromptIntentKind = 'general';
  if (mode === 'business' && !hasInlineCode && !hasCodeAttachment && !isWebsiteOrFullStack) {
    kind = 'business_ops';
  } else if (isDebuggingTask) {
    kind = 'fix_bug';
  } else if (languages.includes('Luau')) {
    kind = 'roblox_luau';
  } else if (hasRefactorKeywords && (mode === 'coding' || hasInlineCode || hasCodeAttachment || languages.length > 0)) {
    kind = 'refactor';
  } else if (hasExplainKeywords && (hasInlineCode || hasCodeAttachment || languages.length > 0)) {
    kind = 'explain_code';
  } else if (
    mode === 'coding' ||
    isWebsiteOrFullStack ||
    (hasBuildKeywords && (languages.length > 0 || hasInlineCode || hasCodeAttachment || /\b(code|script|html|app|website|function|algorithm|game|tool)\b/i.test(text)))
  ) {
    kind = 'build_app';
  } else if (hasBusinessKeywords && !hasInlineCode && !hasCodeAttachment) {
    kind = 'business_ops';
  }

  const isCodingTask =
    mode === 'coding' ||
    isWebsiteOrFullStack ||
    kind === 'build_app' ||
    kind === 'fix_bug' ||
    kind === 'refactor' ||
    kind === 'roblox_luau' ||
    kind === 'explain_code' ||
    hasCodeAttachment ||
    hasInlineCode;

  const langTag = languages.length > 0 ? languages.slice(0, 3).join(' / ') : 'Code';
  let summary = 'General assistant request';
  if (kind === 'fix_bug') {
    summary = `Debugging ${langTag} · root-cause & fix loop`;
  } else if (isLuaUiLibrary) {
    summary = 'Architecting high-level Roblox/Luau UI Library · full component suite';
  } else if (kind === 'roblox_luau') {
    summary = isHighLevelBuild
      ? 'Architecting high-level Roblox Luau system · safety & syntax verified'
      : 'Writing Roblox Luau script · safety & syntax verified';
  } else if (isWebsiteOrFullStack && kind === 'build_app') {
    summary = wantsBackend
      ? 'Building full-stack web artifact · bespoke UI + backend API + verified code'
      : 'Crafting interactive website artifact · bespoke UI & verified code';
  } else if (kind === 'build_app') {
    summary = isHighLevelBuild
      ? `Architecting high-level ${langTag}${wantsMultiFile ? ' (multi-file)' : ''} · verified build`
      : `Building ${langTag}${wantsMultiFile ? ' (multi-file)' : ''} · verified coding`;
  } else if (kind === 'refactor') {
    summary = `Refactoring ${langTag} · behavior & syntax verified`;
  } else if (kind === 'explain_code') {
    summary = `Analyzing ${langTag}`;
  } else if (kind === 'business_ops') {
    summary = 'Business operations & drafting';
  } else if (lower.startsWith('remember')) {
    summary = 'Saving user preference to Chat Memory';
  }

  return {
    kind,
    isCodingTask,
    isDebuggingTask,
    isWebsiteOrFullStack,
    isHighLevelBuild,
    isLuaUiLibrary,
    languages,
    wantsMultiFile,
    wantsBackend,
    summary,
  };
}

interface ParsedCodeFence {
  language: string;
  fileName: string;
  code: string;
}

const SKIP_VERIFY_LANGUAGES = new Set([
  'draft',
  'prompt',
  'system-prompt',
  'prompt-template',
  'text',
  'txt',
  'plain',
  'plaintext',
  'md',
  'markdown',
  'diff',
  'patch',
  'bash',
  'sh',
  'shell',
  'zsh',
  'console',
  'env',
  'sql',
  'yaml',
  'yml',
  'toml',
  'ini',
  'mermaid',
  '',
]);

export function extractFencedCodeBlocks(markdown: string): ParsedCodeFence[] {
  const blocks: ParsedCodeFence[] = [];
  const fenceRegex = /```([a-zA-Z0-9_./:-]*)\s*\r?\n([\s\S]*?)```/g;
  let match: RegExpExecArray | null;
  let idx = 0;

  while ((match = fenceRegex.exec(markdown)) !== null) {
    idx += 1;
    const rawHeader = (match[1] ?? '').trim();
    const code = (match[2] ?? '').replace(/\r\n/g, '\n');

    let language = rawHeader.toLowerCase();
    let fileName = `snippet-${idx}`;

    const colonIdx = rawHeader.indexOf(':');
    if (colonIdx > 0) {
      language = rawHeader.slice(0, colonIdx).trim().toLowerCase();
      fileName = rawHeader.slice(colonIdx + 1).trim() || `snippet-${idx}`;
    } else if (rawHeader.includes('.')) {
      fileName = rawHeader;
      const ext = rawHeader.split('.').pop()?.toLowerCase() ?? '';
      language = ext;
    } else if (language) {
      fileName = `snippet-${idx}.${language}`;
    }

    if (SKIP_VERIFY_LANGUAGES.has(language)) {
      continue;
    }

    blocks.push({ language, fileName, code });
  }

  return blocks;
}

const PLACEHOLDER_PATTERNS: Array<{ re: RegExp; label: string }> = [
  { re: /\/\/\s*\.{3}\s*(add|insert|put)\s+your\s+code\s+here/i, label: 'Placeholder comment "add your code here"' },
  { re: /\/\/\s*\.{3}\s*(rest of|remaining|existing|unchanged|keep|same|previous|other|code|html|css|js|styles|markup|body|sections)/i, label: 'Truncated fix omission comment ("// ... rest/existing")' },
  { re: /\/\/\s*(rest of (the )?(code|file|html|css|js)|existing (code|styles|functions|markup) (stays?|remains?)?( the same| unchanged)?|unchanged code)\b/i, label: 'Truncated fix omission comment ("// existing/unchanged")' },
  { re: /<!--\s*\.{0,3}\s*(rest of|remaining|existing|unchanged|keep|same|previous|other)\b[^>]*-->/i, label: 'Truncated HTML omission comment ("<!-- ... existing/rest -->")' },
  { re: /\/\*\s*\.{0,3}\s*(rest of|remaining|existing|unchanged|keep|same|previous)\b[^*]*\*\//i, label: 'Truncated block omission comment ("/* ... rest/existing */")' },
  { re: /--\s*\.{3}\s*(add|insert|put|more|rest|existing|unchanged)\s*/i, label: 'Luau placeholder/omission comment' },
  { re: /--\s*TODO\s*:?\s*(implement|add|finish|complete)/i, label: 'Unimplemented Luau TODO placeholder' },
  { re: /\/\/\s*TODO\s*:?\s*(implement|add|finish|complete)/i, label: 'Unimplemented TODO placeholder' },
  { re: /#\s*TODO\s*:?\s*(implement|add|finish|complete)/i, label: 'Unimplemented Python/shell TODO placeholder' },
  { re: /#\s*\.{3}\s*(rest of|remaining|existing|unchanged)/i, label: 'Truncated Python omission comment' },
];

export function detectFollowUpCodeEdit(
  message: string,
  history?: Array<{ role: 'user' | 'assistant'; content: string }>
): FollowUpCodeEditContext {
  const empty: FollowUpCodeEditContext = {
    isFollowUpEdit: false,
    previousFileNames: [],
    previousLineCount: 0,
    previousHasHtmlArtifact: false,
    wantsShrinkOrDelete: false,
    latestCodeBlocks: [],
  };

  const safeHistory = Array.isArray(history) ? history : [];
  if (safeHistory.length === 0) return empty;

  // Find the most recent assistant message that contains executable fenced code blocks
  let latestBlocks: ParsedCodeFence[] = [];
  for (let i = safeHistory.length - 1; i >= 0; i -= 1) {
    const turn = safeHistory[i];
    if (turn?.role === 'assistant' && typeof turn.content === 'string' && turn.content.includes('```')) {
      const blocks = extractFencedCodeBlocks(turn.content);
      if (blocks.length > 0) {
        latestBlocks = blocks;
        break;
      }
    }
  }

  if (latestBlocks.length === 0) return empty;

  const rawText = (message ?? '').trim();
  const text = normalizeUserPromptText(rawText);
  // Asking to write/generate a prompt is NEVER a follow-up edit to previous HTML/code
  if (isPromptWritingRequest(text)) return empty;

  const explicitStartFresh =
    /\b(start\s+(over|from\s+scratch|fresh)|from\s+scratch|brand\s+new\s+(website|app|project|site)|completely\s+new\s+(website|app|design|project)|ignore\s+(the\s+)?previous|forget\s+(the\s+)?previous|build\s+a\s+different|naya\s+(website|site|app|design)\s+banao)\b/i.test(
      text
    );
  if (explicitStartFresh) return empty;

  const isPureExplanation =
    /^(explain|what\s+does|how\s+does|why\s+did\s+you|summarize|walk\s+me\s+through|samjhao)\b/i.test(text) &&
    !/\b(fix|change|update|edit|add|remove|replace|modify|refactor|repair|make\s+it|adjust|style)\b/i.test(text) &&
    !HINGLISH_EDIT_FIX_RE.test(rawText);
  if (isPureExplanation) return empty;

  const hasEditOrFixIntent =
    /\b(fix|bug|broken|error|issue|crash|not\s+working|doesn'?t\s+work|repair|debug|patch|solve|resolve|change|update|edit|modify|adjust|tweak|improve|refine|enhance|polish|add|remove|delete|hide|show|move|align|center|resize|recolor|color|theme|font|dark\s+mode|light\s+mode|responsive|mobile|navbar|header|footer|hero|button|modal|drawer|menu|form|cart|slider|tab|animation|hover|scroll|click|link|icon|logo|text|title|section|card|layout|spacing|padding|margin|border|shadow|pricing|testimonials?|faq|make\s+(it|the|this)|looks?\s+(weird|broken|off|bad|cramped|ugly)|still\s+(broken|not|showing|missing|overlapping)|also\s+(add|fix|change|include|make))\b/i.test(
      text
    ) || HINGLISH_EDIT_FIX_RE.test(rawText);

  if (!hasEditOrFixIntent) return empty;

  const previousLineCount = latestBlocks.reduce(
    (sum, b) => sum + b.code.trim().split('\n').length,
    0
  );
  const previousHasHtmlArtifact = latestBlocks.some(
    (b) =>
      (b.language === 'html' || b.language === 'htm') &&
      (/<!doctype\s+html/i.test(b.code) || /<html[\s>]/i.test(b.code))
  );
  const wantsShrinkOrDelete =
    /\b(shorten|make\s+it\s+shorter|simplify|minimal|strip\s+down|remove\s+most|delete\s+(the\s+)?(sections?|everything|all))\b/i.test(
      text
    );

  return {
    isFollowUpEdit: true,
    previousFileNames: latestBlocks.map((b) => b.fileName),
    previousLineCount,
    previousHasHtmlArtifact,
    wantsShrinkOrDelete,
    latestCodeBlocks: latestBlocks,
  };
}

function checkPlaceholders(fileName: string, language: string, code: string): CodeVerificationIssue[] {
  const issues: CodeVerificationIssue[] = [];
  const lines = code.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    for (const pat of PLACEHOLDER_PATTERNS) {
      if (pat.re.test(line)) {
        issues.push({
          file: fileName,
          language,
          severity: 'error',
          line: i + 1,
          message: `${pat.label} found — deliver complete working code.`,
        });
      }
    }
  }
  return issues;
}

function verifyJsTsWithEsbuild(
  code: string,
  loader: 'js' | 'jsx' | 'ts' | 'tsx',
  fileName: string,
  language: string,
  lineOffset = 0
): CodeVerificationIssue[] {
  try {
    transformSync(code, {
      loader,
      target: 'es2022',
      format: 'esm',
    });
    return [];
  } catch (err: unknown) {
    const esbuildErr = err as {
      errors?: Array<{ text?: string; location?: { line?: number; column?: number } | null }>;
      message?: string;
    };
    const errors = Array.isArray(esbuildErr?.errors) ? esbuildErr.errors : [];
    if (errors.length > 0) {
      return errors.slice(0, 5).map((e) => ({
        file: fileName,
        language,
        severity: 'error' as const,
        line: e.location?.line ? e.location.line + lineOffset : undefined,
        column: e.location?.column !== undefined ? e.location.column + 1 : undefined,
        message: e.text || 'Syntax error',
      }));
    }
    return [
      {
        file: fileName,
        language,
        severity: 'error',
        message: esbuildErr?.message || 'JavaScript/TypeScript syntax error',
      },
    ];
  }
}

function verifyHtmlDocument(code: string, fileName: string): CodeVerificationIssue[] {
  const issues: CodeVerificationIssue[] = [];

  // 1. Check balanced <script> and <style> tags
  const openScripts = (code.match(/<script\b[^>]*>/gi) ?? []).length;
  const closeScripts = (code.match(/<\/script>/gi) ?? []).length;
  if (openScripts !== closeScripts) {
    issues.push({
      file: fileName,
      language: 'html',
      severity: 'error',
      message: `Unbalanced <script> tags (${openScripts} opening vs ${closeScripts} closing).`,
    });
  }

  const openStyles = (code.match(/<style\b[^>]*>/gi) ?? []).length;
  const closeStyles = (code.match(/<\/style>/gi) ?? []).length;
  if (openStyles !== closeStyles) {
    issues.push({
      file: fileName,
      language: 'html',
      severity: 'error',
      message: `Unbalanced <style> tags (${openStyles} opening vs ${closeStyles} closing).`,
    });
  }

  // 2. Collect declared HTML IDs and dynamic IDs in script strings
  const declaredIds = new Set<string>();
  const idAttrRe = /\bid\s*=\s*["']([a-zA-Z0-9_-]+)["']/g;
  let idMatch: RegExpExecArray | null;
  while ((idMatch = idAttrRe.exec(code)) !== null) {
    declaredIds.add(idMatch[1]);
  }
  const dynamicIdRe = /\.id\s*=\s*["']([a-zA-Z0-9_-]+)["']/g;
  while ((idMatch = dynamicIdRe.exec(code)) !== null) {
    declaredIds.add(idMatch[1]);
  }

  // 3. Extract and syntax-check inline <script> blocks using esbuild
  const scriptBlockRe = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let sMatch: RegExpExecArray | null;
  let scriptIndex = 0;

  while ((sMatch = scriptBlockRe.exec(code)) !== null) {
    scriptIndex += 1;
    const attrs = (sMatch[1] ?? '').toLowerCase();
    const scriptBody = sMatch[2] ?? '';

    // Skip external scripts or non-JS script types (json, ld+json, importmap, template)
    if (/\bsrc\s*=/.test(attrs)) continue;
    if (
      /\btype\s*=\s*["'](application\/json|application\/ld\+json|importmap|text\/template)["']/.test(
        attrs
      )
    ) {
      continue;
    }
    if (!scriptBody.trim()) continue;

    const lineOffset = code.slice(0, sMatch.index).split('\n').length - 1;
    const isBabelJsx = /text\/babel/.test(attrs);
    const jsIssues = verifyJsTsWithEsbuild(
      scriptBody,
      isBabelJsx ? 'jsx' : 'js',
      `${fileName} (<script #${scriptIndex}>)`,
      'javascript',
      lineOffset
    );
    issues.push(...jsIssues);

    // 4. Cross-check document.getElementById('foo') against declared IDs in single-file HTML
    if (declaredIds.size > 0) {
      const getByIdRe = /document\.getElementById\(\s*["']([a-zA-Z0-9_-]+)["']\s*\)/g;
      let refMatch: RegExpExecArray | null;
      const checkedMissing = new Set<string>();
      while ((refMatch = getByIdRe.exec(scriptBody)) !== null) {
        const refId = refMatch[1];
        if (!declaredIds.has(refId) && !checkedMissing.has(refId)) {
          // Ignore if HTML is constructed via innerHTML/template literals mentioning id="refId"
          if (!code.includes(`id="${refId}"`) && !code.includes(`id='${refId}'`)) {
            checkedMissing.add(refId);
            issues.push({
              file: fileName,
              language: 'html',
              severity: 'error',
              message: `JavaScript calls document.getElementById("${refId}"), but no element with id="${refId}" exists in the HTML.`,
            });
          }
        }
      }
    }
  }

  return issues;
}

function verifyCssCode(code: string, fileName: string): CodeVerificationIssue[] {
  const issues: CodeVerificationIssue[] = [];
  // Strip string literals & comments
  let depth = 0;
  let inComment = false;
  let inQuote: string | null = null;

  for (let i = 0; i < code.length; i += 1) {
    const ch = code[i];
    const next = code[i + 1];
    if (inComment) {
      if (ch === '*' && next === '/') {
        inComment = false;
        i += 1;
      }
      continue;
    }
    if (inQuote) {
      if (ch === '\\') {
        i += 1;
        continue;
      }
      if (ch === inQuote) inQuote = null;
      continue;
    }
    if (ch === '/' && next === '*') {
      inComment = true;
      i += 1;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inQuote = ch;
      continue;
    }
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth < 0) {
        issues.push({
          file: fileName,
          language: 'css',
          severity: 'error',
          message: 'Extra closing "}" brace in CSS.',
        });
        break;
      }
    }
  }

  if (inComment) {
    issues.push({
      file: fileName,
      language: 'css',
      severity: 'error',
      message: 'Unclosed /* comment in CSS.',
    });
  }
  if (depth > 0) {
    issues.push({
      file: fileName,
      language: 'css',
      severity: 'error',
      message: `Missing ${depth} closing "}" brace(s) in CSS.`,
    });
  }
  return issues;
}

function stripStringsAndLineComments(code: string, commentPrefix: string): string {
  const out: string[] = [];
  let inQuote: string | null = null;
  for (let i = 0; i < code.length; i += 1) {
    const ch = code[i];
    if (inQuote) {
      if (ch === '\\') {
        i += 1;
        continue;
      }
      if (ch === inQuote) inQuote = null;
      else if (ch === '\n') out.push('\n');
      continue;
    }
    if (code.startsWith(commentPrefix, i)) {
      while (i < code.length && code[i] !== '\n') i += 1;
      out.push('\n');
      continue;
    }
    if (ch === '"' || ch === "'") {
      inQuote = ch;
      out.push(' ');
      continue;
    }
    out.push(ch);
  }
  return out.join('');
}

function checkBalancedDelimiters(
  cleaned: string,
  fileName: string,
  language: string
): CodeVerificationIssue[] {
  const stack: string[] = [];
  const pairs: Record<string, string> = { '(': ')', '[': ']', '{': '}' };
  const closing: Record<string, string> = { ')': '(', ']': '[', '}': '{' };

  for (let i = 0; i < cleaned.length; i += 1) {
    const ch = cleaned[i];
    if (pairs[ch]) {
      stack.push(ch);
    } else if (closing[ch]) {
      const top = stack.pop();
      if (top !== closing[ch]) {
        return [
          {
            file: fileName,
            language,
            severity: 'error',
            message: `Mismatched closing delimiter "${ch}".`,
          },
        ];
      }
    }
  }

  if (stack.length > 0) {
    return [
      {
        file: fileName,
        language,
        severity: 'error',
        message: `Unclosed "${stack[stack.length - 1]}" delimiter (${stack.length} unclosed).`,
      },
    ];
  }
  return [];
}

function verifyLuauCode(code: string, fileName: string): CodeVerificationIssue[] {
  const issues: CodeVerificationIssue[] = [];
  // Strip --[[ ... ]] multi-line comments and -- single-line comments + strings
  const noBlockComments = code.replace(/--\[\[[\s\S]*?\]\]/g, (m) => m.replace(/[^\n]/g, ' '));
  const cleaned = stripStringsAndLineComments(noBlockComments, '--');

  issues.push(...checkBalancedDelimiters(cleaned, fileName, 'luau'));

  // Count block openers vs end/until
  // Note: "elseif ... then" does not open a new block; "if ... then" opens 1, "function" opens 1,
  // "do" opens 1 (standalone or from for/while), "repeat" pairs with "until".
  const tokens = cleaned.match(/\b(function|if|elseif|else|then|for|while|do|repeat|until|end)\b/g) ?? [];
  let blockDepth = 0;
  let repeatDepth = 0;
  let prevWasIf = false;

  for (const tok of tokens) {
    if (tok === 'function') {
      blockDepth += 1;
      prevWasIf = false;
    } else if (tok === 'if') {
      blockDepth += 1;
      prevWasIf = true;
    } else if (tok === 'elseif') {
      prevWasIf = false;
    } else if (tok === 'do') {
      blockDepth += 1;
      prevWasIf = false;
    } else if (tok === 'repeat') {
      repeatDepth += 1;
      prevWasIf = false;
    } else if (tok === 'until') {
      repeatDepth -= 1;
      if (repeatDepth < 0) {
        issues.push({
          file: fileName,
          language: 'luau',
          severity: 'error',
          message: 'Unexpected "until" without matching "repeat".',
        });
        break;
      }
      prevWasIf = false;
    } else if (tok === 'end') {
      blockDepth -= 1;
      if (blockDepth < 0) {
        issues.push({
          file: fileName,
          language: 'luau',
          severity: 'error',
          message: 'Extra "end" keyword without a matching block opener.',
        });
        break;
      }
      prevWasIf = false;
    } else if (tok === 'then') {
      // Note: Luau inline `if cond then a else b` ternary expressions don't use `end`.
      // We handle this gently below by checking if a line has `if ... then ... else ...` on a single line.
      void prevWasIf;
    }
  }

  // Adjust for single-line Luau ternary expressions: `= if ... then ... else ...`
  const inlineTernaryMatches =
    cleaned.match(/(?:=|return|\(|,)\s*if\b[^\n]+\bthen\b[^\n]+\belse\b[^\n]+/g) ?? [];
  const adjustedDepth = blockDepth - inlineTernaryMatches.length;

  if (adjustedDepth > 0) {
    issues.push({
      file: fileName,
      language: 'luau',
      severity: 'error',
      message: `Missing ${adjustedDepth} "end" keyword(s) in Luau code.`,
    });
  }
  if (repeatDepth > 0) {
    issues.push({
      file: fileName,
      language: 'luau',
      severity: 'error',
      message: `Missing ${repeatDepth} "until" keyword(s) for "repeat" loop.`,
    });
  }

  if (/\b(loadstring|getfenv|setfenv)\s*\(/.test(cleaned)) {
    issues.push({
      file: fileName,
      language: 'luau',
      severity: 'warning',
      message: 'Uses loadstring/getfenv/setfenv which are unsafe or disabled in modern Roblox Luau.',
    });
  }

  return issues;
}

function verifyPythonCode(code: string, fileName: string): CodeVerificationIssue[] {
  const issues: CodeVerificationIssue[] = [];
  // Strip triple-quoted strings first
  const noTriple = code
    .replace(/"""[\s\S]*?"""/g, '""')
    .replace(/'''[\s\S]*?'''/g, "''");
  const cleaned = stripStringsAndLineComments(noTriple, '#');

  issues.push(...checkBalancedDelimiters(cleaned, fileName, 'python'));

  // Check single-line def/class headers missing trailing colon
  const lines = cleaned.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const trimmed = lines[i].trim();
    if (/^(async\s+)?(def|class)\s+[A-Za-z_]\w*\s*(\([^)]*\))?\s*(->\s*[^:]+)?$/.test(trimmed)) {
      if (!trimmed.endsWith(':') && !trimmed.endsWith('\\') && !trimmed.endsWith('(') && !trimmed.endsWith(',')) {
        issues.push({
          file: fileName,
          language: 'python',
          severity: 'error',
          line: i + 1,
          message: `Missing ":" at end of Python header "${trimmed.slice(0, 60)}".`,
        });
      }
    }
  }

  return issues;
}

const WEBSITE_STUB_PATTERNS: Array<{ re: RegExp; message: string }> = [
  {
    re: /\b(visual\s+placeholder|image\s+placeholder|hero\s+placeholder|photo\s+placeholder)\b/i,
    message:
      'Found literal "Visual/Image Placeholder" text — replace with bespoke inline SVG artwork or a rich interactive UI card.',
  },
  {
    re: /\bproject\s+(alpha|beta|gamma|one|two|1|2)\b/i,
    message:
      'Found generic stub project titles ("Project Alpha/Beta") — replace with realistic named case studies, metrics, and stack details.',
  },
  {
    re: /\blorem\s+ipsum\b/i,
    message: 'Found "Lorem ipsum" filler text — write realistic, domain-authentic copy.',
  },
];

function verifyFullStackWebsiteQuality(
  blocks: ParsedCodeFence[],
  options?: { requireBackend?: boolean; isHyper?: boolean }
): CodeVerificationIssue[] {
  const issues: CodeVerificationIssue[] = [];
  const requireBackend = options?.requireBackend ?? true;
  const isHyper = Boolean(options?.isHyper);
  const htmlBlock = blocks.find((b) => b.language === 'html' || b.language === 'htm');
  const hasBackendOrPkg = blocks.some(
    (b) =>
      b.language === 'js' ||
      b.language === 'javascript' ||
      b.language === 'ts' ||
      b.language === 'typescript' ||
      b.language === 'json' ||
      /server\.|package\.json/i.test(b.fileName)
  );

  if (!htmlBlock) {
    issues.push({
      file: 'index.html',
      language: 'html',
      severity: 'error',
      message:
        'Missing complete self-contained `index.html` frontend artifact for the website.',
    });
    return issues;
  }

  if (requireBackend && !hasBackendOrPkg) {
    issues.push({
      file: 'server.js',
      language: 'javascript',
      severity: 'error',
      message:
        'Missing full-stack backend (`server.js` Express API + `package.json`) — include both frontend and runnable backend files.',
    });
  }

  const html = htmlBlock.code;
  const lineCount = html.split('\n').length;

  for (const pat of WEBSITE_STUB_PATTERNS) {
    if (pat.re.test(html)) {
      issues.push({
        file: htmlBlock.fileName,
        language: 'html',
        severity: 'error',
        message: pat.message,
      });
    }
  }

  // Disallow blocking browser alert()/confirm()/prompt() inside <script>
  const scriptMatches = html.match(/<script\b[^>]*>([\s\S]*?)<\/script>/gi) ?? [];
  const allScripts = scriptMatches.join('\n');
  if (/(?:^|[^\w$.])(?:window\.)?(?:alert|confirm|prompt)\s*\(/.test(allScripts)) {
    issues.push({
      file: htmlBlock.fileName,
      language: 'html',
      severity: 'error',
      message:
        'Uses blocking `alert()`/`confirm()`/`prompt()` — replace with a clean inline UI toast notification or modal.',
    });
  }

  // Require responsive breakpoints via CSS @media OR Tailwind responsive utility classes
  const hasMediaQueries = /@media\s*\(/i.test(html);
  const hasTailwindResponsive =
    /tailwindcss\.com/i.test(html) && /\b(?:sm|md|lg|xl):[a-z]/i.test(html);
  if (!hasMediaQueries && !hasTailwindResponsive) {
    issues.push({
      file: htmlBlock.fileName,
      language: 'html',
      severity: 'error',
      message:
        'Missing `@media` or responsive breakpoint rules (`md:` / `lg:`) — add responsive breakpoints so mobile 390px layouts stack cleanly.',
    });
  }

  // Require real visual richness (bespoke SVG artwork or canvas)
  if (!/<svg\b|<canvas\b/i.test(html)) {
    issues.push({
      file: htmlBlock.fileName,
      language: 'html',
      severity: 'error',
      message:
        'Missing bespoke inline `<svg>` visual artwork/icons — add custom SVG illustrations, charts, or UI visuals (never plain empty boxes).',
    });
  }

  const minHtmlLines = isHyper ? 320 : 180;
  if (lineCount < minHtmlLines) {
    issues.push({
      file: htmlBlock.fileName,
      language: 'html',
      severity: 'error',
      message: isHyper
        ? `IND HYPER website artifact is too short (${lineCount} lines) — expand into an epic, deeply crafted interactive website (550–900+ lines) with bespoke domain art direction, curated typography, rich interactive hero visual, multi-section architecture, working interactive controls/filters/modals/toasts, bespoke inline SVGs, and polished mobile responsiveness.`
        : `Frontend HTML is too sparse (${lineCount} lines) — expand into a complete, studio-grade website (300+ lines) with polished typography, bespoke visuals, interactive controls, and responsive mobile layout.`,
    });
  }

  return issues;
}

function verifyHighLevelCodeQuality(
  blocks: ParsedCodeFence[],
  options: { requireHighLevelCode?: boolean; requireLuaUiLibrary?: boolean; isHyper?: boolean }
): CodeVerificationIssue[] {
  const issues: CodeVerificationIssue[] = [];
  const isHyper = Boolean(options.isHyper);
  const totalLines = blocks.reduce((acc, b) => acc + b.code.split('\n').length, 0);

  if (options.requireLuaUiLibrary) {
    const luaBlocks = blocks.filter((b) => b.language === 'lua' || b.language === 'luau');
    const combinedLua = luaBlocks.map((b) => b.code).join('\n');
    const luaLines = combinedLua.split('\n').length;
    const primaryFile = luaBlocks[0]?.fileName ?? 'UILibrary.luau';

    if (luaBlocks.length === 0) {
      issues.push({
        file: primaryFile,
        language: 'luau',
        severity: 'error',
        message: 'Missing Luau/Lua code block for the requested UI Library.',
      });
      return issues;
    }

    const minLuaLines = isHyper ? 420 : 300;
    if (luaLines < minLuaLines) {
      issues.push({
        file: primaryFile,
        language: 'luau',
        severity: 'error',
        message: `Luau UI Library is too short (${luaLines} lines) — deliver a complete, high-level, production-grade Roblox Luau UI Library (${isHyper ? '550+' : '380+'} lines) with Window + draggable topbar + minimize/close, Theme system, Tab navigation, Section containers, Button, Toggle Switch, Draggable Slider, Dropdown menu, TextBox input, Keybind picker, Toast Notifications, TweenService animations, Connection/Maid cleanup, and a complete Demo usage script.`,
      });
    }

    const requiredFeatures: Array<{ re: RegExp; label: string }> = [
      { re: /TweenService/i, label: 'smooth TweenService UI animations' },
      { re: /Toggle/i, label: 'interactive Toggle control' },
      { re: /Slider/i, label: 'draggable Slider control' },
      { re: /Dropdown/i, label: 'expandable Dropdown control' },
      { re: /Notify|Notification|Toast/i, label: 'Toast Notification system' },
      { re: /Tab/i, label: 'multi-Tab navigation system' },
    ];

    const missing = requiredFeatures.filter((f) => !f.re.test(combinedLua)).map((f) => f.label);
    if (missing.length >= 1) {
      issues.push({
        file: primaryFile,
        language: 'luau',
        severity: 'error',
        message: `Luau UI Library is missing core high-level components: ${missing.join(', ')}. Implement every component completely with real event handling and animations.`,
      });
    }
    return issues;
  }

  const minHighLevelLines = isHyper ? 280 : 160;
  if (options.requireHighLevelCode && totalLines < minHighLevelLines) {
    const primaryFile = blocks[0]?.fileName ?? 'code';
    const primaryLang = blocks[0]?.language ?? 'text';
    issues.push({
      file: primaryFile,
      language: primaryLang,
      severity: 'error',
      message: `Code output is too brief (${totalLines} lines total) for a ${isHyper ? 'IND HYPER epic' : 'high-level'} build — expand into a complete, deeply engineered production-grade architecture (${isHyper ? '400+' : '220+'} lines) with full feature implementation, rich edge-case handling, clean modular structure, and working usage/demo code.`,
    });
  }

  return issues;
}

const PROMPT_REQUIREMENT_CHECKS: Array<{
  id: string;
  promptRe: RegExp;
  codeRe: RegExp;
  label: string;
}> = [
  {
    id: 'theme-toggle',
    promptRe: /\b(dark\s*\/?\s*light|light\s*\/?\s*dark|theme\s*(toggle|switch|switcher)|dark\s*mode\s*toggle)\b/i,
    codeRe: /(theme|dark[-_]?mode|data-theme|classList\.toggle\s*\(\s*['"]dark)/i,
    label: 'working dark/light theme toggle',
  },
  {
    id: 'search-filter',
    promptRe: /\b(search\s*(bar|box|input|filter)?|live\s*search|filter\s*(by|tabs?|buttons?))\b/i,
    codeRe: /(type=["']search["']|placeholder=["'][^"']*search|filter|searchInput|oninput|addEventListener\s*\(\s*['"]input)/i,
    label: 'interactive search or category filter',
  },
  {
    id: 'cart-drawer',
    promptRe: /\b(shopping\s*cart|cart\s*(drawer|sidebar|modal)|add\s*to\s*cart|checkout)\b/i,
    codeRe: /(cart|checkout|addToCart|removeFromCart|quantity|subtotal)/i,
    label: 'interactive cart / checkout workflow',
  },
  {
    id: 'modal-drawer',
    promptRe: /\b(modal|popup|pop-up|dialog|drawer)\b/i,
    codeRe: /(modal|dialog|drawer|aria-modal|closeModal|openModal)/i,
    label: 'interactive modal or drawer component',
  },
  {
    id: 'contact-or-booking-form',
    promptRe: /\b(contact\s*form|booking\s*form|sign\s*up\s*form|login\s*form|registration\s*form)\b/i,
    codeRe: /(<form\b|onsubmit|addEventListener\s*\(\s*['"]submit)/i,
    label: 'working interactive form with submit handling',
  },
  {
    id: 'chart-visualization',
    promptRe: /\b(chart|graph|sparkline|analytics\s*chart|bar\s*chart|line\s*chart|pie\s*chart)\b/i,
    codeRe: /(<svg\b|<canvas\b|Chart\(|recharts|polyline|path\s+d=)/i,
    label: 'visual chart / SVG / canvas data visualization',
  },
  {
    id: 'toast-notifications',
    promptRe: /\b(toast|notification\s*system|notifications?)\b/i,
    codeRe: /(toast|notify|notification)/i,
    label: 'non-blocking toast notification feedback',
  },
  {
    id: 'local-storage',
    promptRe: /\b(localstorage|save\s*data|persist|persistent\s*state)\b/i,
    codeRe: /localStorage\.(getItem|setItem)/i,
    label: 'localStorage state persistence',
  },
  {
    id: 'drag-drop',
    promptRe: /\b(drag\s*(and|&|n)\s*drop|draggable|kanban)\b/i,
    codeRe: /(draggable|ondragstart|dragstart|pointerdown|UserInputService)/i,
    label: 'interactive drag-and-drop behavior',
  },
  {
    id: 'pricing-section',
    promptRe: /\b(pricing\s*(section|table|plans?|cards?|tiers?)?)\b/i,
    codeRe: /(pricing|\/mo|\/month|per\s*month|starter|pro\s*plan|enterprise|tier|₹\s*\d+|\$\s*\d+)/i,
    label: 'pricing plans section',
  },
  {
    id: 'testimonials-section',
    promptRe: /\b(testimonials?|customer\s*reviews?)\b/i,
    codeRe: /(testimonial|review|blockquote|quote|rating|★)/i,
    label: 'testimonials / reviews section',
  },
  {
    id: 'faq-accordion',
    promptRe: /\b(faq|frequently\s*asked|accordion)\b/i,
    codeRe: /(faq|frequently\s*asked|accordion|<details\b)/i,
    label: 'FAQ / accordion section',
  },
  {
    id: 'menu-catalog',
    promptRe: /\b(menu\s*(section|card|list|items?)?|coffee\s*menu|food\s*menu)\b/i,
    codeRe: /(menu|espresso|latte|cappuccino|item|price|add\s*to\s*(order|cart))/i,
    label: 'interactive menu section',
  },
];

export function checkPromptRequirements(
  userPrompt: string,
  blocks: ParsedCodeFence[],
  extra?: { brandNames?: string[]; mustAvoid?: string[] }
): CodeVerificationIssue[] {
  const prompt = normalizeUserPromptText(userPrompt ?? '');
  if (!prompt || blocks.length === 0) return [];

  const combinedCode = blocks.map((b) => b.code).join('\n');
  const combinedLower = combinedCode.toLowerCase();
  const primary = blocks[0];
  const issues: CodeVerificationIssue[] = [];

  for (const req of PROMPT_REQUIREMENT_CHECKS) {
    if (req.promptRe.test(prompt) && !req.codeRe.test(combinedCode)) {
      issues.push({
        file: primary.fileName,
        language: primary.language,
        severity: 'error',
        message: `Prompt requirement not yet satisfied: missing ${req.label} requested by the user.`,
      });
    }
  }

  // Verify explicitly requested brand/app names actually appear in the generated code
  const brandNames = Array.isArray(extra?.brandNames) ? extra.brandNames : [];
  for (const brand of brandNames) {
    const cleanBrand = brand.trim();
    if (cleanBrand.length >= 2 && !combinedLower.includes(cleanBrand.toLowerCase())) {
      issues.push({
        file: primary.fileName,
        language: primary.language,
        severity: 'error',
        message: `Prompt requirement not yet satisfied: user explicitly requested brand/name "${cleanBrand}", which is missing from the code.`,
      });
    }
  }

  // Also check explicit minimum line count if the user specifically asked for e.g. "500 lines"
  const lineTargetMatch = prompt.match(/\b(\d{3,4})\+?\s*lines?\b/i);
  if (lineTargetMatch) {
    const requestedLines = Math.min(1200, Math.max(100, Number(lineTargetMatch[1])));
    const actualLines = blocks.reduce((sum, b) => sum + b.code.trim().split('\n').length, 0);
    if (actualLines < Math.floor(requestedLines * 0.7)) {
      issues.push({
        file: primary.fileName,
        language: primary.language,
        severity: 'error',
        message: `Code length (${actualLines} lines) is still shorter than the user's requested ~${requestedLines} lines — expand with richer real features, interactions, and styling.`,
      });
    }
  }

  return issues;
}

export function verifyCodeBlocks(
  markdownReply: string,
  options?: {
    requireFullStackWebsite?: boolean;
    requireBackend?: boolean;
    requireHighLevelCode?: boolean;
    requireLuaUiLibrary?: boolean;
    isHyper?: boolean;
    userPrompt?: string;
    brandNames?: string[];
    mustAvoid?: string[];
    followUpEditContext?: FollowUpCodeEditContext;
  }
): CodeVerificationReport {
  const blocks = extractFencedCodeBlocks(markdownReply);
  if (blocks.length === 0) {
    return {
      filesChecked: 0,
      passed: true,
      errorCount: 0,
      warningCount: 0,
      issues: [],
      summary: 'No executable code blocks to verify.',
    };
  }

  const issues: CodeVerificationIssue[] = [];

  for (const block of blocks) {
    const lang = block.language;
    issues.push(...checkPlaceholders(block.fileName, lang, block.code));

    if (lang === 'js' || lang === 'javascript' || lang === 'mjs' || lang === 'cjs') {
      issues.push(...verifyJsTsWithEsbuild(block.code, 'js', block.fileName, lang));
    } else if (lang === 'jsx') {
      issues.push(...verifyJsTsWithEsbuild(block.code, 'jsx', block.fileName, lang));
    } else if (lang === 'ts' || lang === 'typescript') {
      issues.push(...verifyJsTsWithEsbuild(block.code, 'ts', block.fileName, lang));
    } else if (lang === 'tsx') {
      issues.push(...verifyJsTsWithEsbuild(block.code, 'tsx', block.fileName, lang));
    } else if (lang === 'html' || lang === 'htm') {
      issues.push(...verifyHtmlDocument(block.code, block.fileName));
    } else if (lang === 'json') {
      try {
        JSON.parse(block.code);
      } catch (err) {
        issues.push({
          file: block.fileName,
          language: 'json',
          severity: 'error',
          message: err instanceof Error ? err.message : 'Invalid JSON syntax.',
        });
      }
    } else if (lang === 'css') {
      issues.push(...verifyCssCode(block.code, block.fileName));
    } else if (lang === 'lua' || lang === 'luau') {
      issues.push(...verifyLuauCode(block.code, block.fileName));
    } else if (lang === 'py' || lang === 'python') {
      issues.push(...verifyPythonCode(block.code, block.fileName));
    }
  }

  // Enforce complete-file preservation on follow-up fix/edit turns (prevent partial 10-line fix snippets)
  const followUp = options?.followUpEditContext;
  if (followUp?.isFollowUpEdit && !followUp.wantsShrinkOrDelete) {
    const newTotalLines = blocks.reduce((sum, b) => sum + b.code.trim().split('\n').length, 0);
    if (followUp.previousHasHtmlArtifact) {
      const htmlBlock = blocks.find((b) => b.language === 'html' || b.language === 'htm');
      if (!htmlBlock || (!/<!doctype\s+html/i.test(htmlBlock.code) && !/<html[\s>]/i.test(htmlBlock.code))) {
        issues.push({
          file: followUp.previousFileNames[0] || 'index.html',
          language: 'html',
          severity: 'error',
          message:
            'Follow-up fix returned only a partial snippet instead of the complete `index.html` document — preserve all existing sections/styles/scripts from the previous version and return the full updated file.',
        });
      } else if (
        followUp.previousLineCount >= 80 &&
        newTotalLines < Math.floor(followUp.previousLineCount * 0.55)
      ) {
        issues.push({
          file: htmlBlock.fileName,
          language: 'html',
          severity: 'error',
          message: `Follow-up fix truncated the file (${newTotalLines} lines vs ${followUp.previousLineCount} lines in the previous version) — keep ALL existing working sections, styling, and features intact and apply ONLY the requested fix in the complete file.`,
        });
      }
    } else if (
      followUp.previousLineCount >= 60 &&
      newTotalLines < Math.floor(followUp.previousLineCount * 0.5)
    ) {
      issues.push({
        file: blocks[0]?.fileName || followUp.previousFileNames[0] || 'code',
        language: blocks[0]?.language || 'text',
        severity: 'error',
        message: `Follow-up fix returned only a partial snippet (${newTotalLines} lines vs ${followUp.previousLineCount} lines previously) — return the COMPLETE updated file preserving all existing code instead of only a few changed lines.`,
      });
    }
  }

  if (options?.userPrompt) {
    issues.push(
      ...checkPromptRequirements(options.userPrompt, blocks, {
        brandNames: options.brandNames,
        mustAvoid: options.mustAvoid,
      })
    );
  }

  if (options?.requireFullStackWebsite) {
    issues.push(
      ...verifyFullStackWebsiteQuality(blocks, {
        requireBackend: options.requireBackend ?? true,
        isHyper: options.isHyper,
      })
    );
  } else if (options?.requireLuaUiLibrary || options?.requireHighLevelCode) {
    issues.push(
      ...verifyHighLevelCodeQuality(blocks, {
        requireHighLevelCode: options.requireHighLevelCode,
        requireLuaUiLibrary: options.requireLuaUiLibrary,
        isHyper: options.isHyper,
      })
    );
  }

  const errorCount = issues.filter((i) => i.severity === 'error').length;
  const warningCount = issues.filter((i) => i.severity === 'warning').length;
  const passed = errorCount === 0;

  const summary = passed
    ? `Verified ${blocks.length} code block${blocks.length === 1 ? '' : 's'} — 0 syntax, DOM, or quality errors`
    : `Found ${errorCount} issue${errorCount === 1 ? '' : 's'} across ${blocks.length} code block${blocks.length === 1 ? '' : 's'}`;

  return {
    filesChecked: blocks.length,
    passed,
    errorCount,
    warningCount,
    issues,
    summary,
  };
}

/**
 * Sandboxed syntax & pure-JS execution verifier for the agent's `verify_code_snippet` tool.
 * Runs in an isolated V8 VM context with zero Node globals (no process, require, fs, fetch)
 * and a strict 400ms CPU timeout.
 */
export function runSandboxedJsCheck(input: {
  code: string;
  language?: string;
  testCode?: string;
}): SandboxedJsCheckResult {
  const rawLang = (input.language ?? 'javascript').toLowerCase();
  const code = String(input.code ?? '');
  const testCode = typeof input.testCode === 'string' ? input.testCode : '';

  if (rawLang === 'html' || rawLang === 'htm') {
    const htmlIssues = verifyHtmlDocument(code, 'index.html');
    if (htmlIssues.length > 0) {
      return {
        syntaxOk: false,
        runtimeOk: false,
        logs: [],
        error: htmlIssues.map((i) => i.message).join(' | '),
      };
    }
    return {
      syntaxOk: true,
      runtimeOk: true,
      logs: ['HTML structure, inline scripts, and DOM ID references passed verification.'],
    };
  }

  if (rawLang === 'luau' || rawLang === 'lua') {
    const luauIssues = verifyLuauCode(code, 'script.luau');
    const errs = luauIssues.filter((i) => i.severity === 'error');
    return {
      syntaxOk: errs.length === 0,
      runtimeOk: errs.length === 0,
      logs: errs.length === 0 ? ['Luau block structure and syntax checks passed.'] : [],
      error: errs.length > 0 ? errs.map((i) => i.message).join(' | ') : undefined,
    };
  }

  if (rawLang === 'python' || rawLang === 'py') {
    const pyIssues = verifyPythonCode(code, 'script.py');
    return {
      syntaxOk: pyIssues.length === 0,
      runtimeOk: pyIssues.length === 0,
      logs: pyIssues.length === 0 ? ['Python syntax & delimiter checks passed.'] : [],
      error: pyIssues.length > 0 ? pyIssues.map((i) => i.message).join(' | ') : undefined,
    };
  }

  if (rawLang === 'json') {
    try {
      JSON.parse(code);
      return { syntaxOk: true, runtimeOk: true, logs: ['Valid JSON.'] };
    } catch (err) {
      return {
        syntaxOk: false,
        runtimeOk: false,
        logs: [],
        error: err instanceof Error ? err.message : 'Invalid JSON',
      };
    }
  }

  // JavaScript / TypeScript: compile with esbuild then run in isolated vm if no JSX
  const loader: 'js' | 'jsx' | 'ts' | 'tsx' =
    rawLang === 'tsx'
      ? 'tsx'
      : rawLang === 'ts' || rawLang === 'typescript'
        ? 'ts'
        : rawLang === 'jsx'
          ? 'jsx'
          : 'js';

  let compiledJs: string;
  try {
    const combined = testCode.trim() ? `${code}\n\n${testCode}` : code;
    const transformed = transformSync(combined, {
      loader,
      target: 'es2022',
      format: 'iife',
    });
    compiledJs = transformed.code;
  } catch (err: unknown) {
    const esbuildErr = err as {
      errors?: Array<{ text?: string; location?: { line?: number; column?: number } | null }>;
      message?: string;
    };
    const first = Array.isArray(esbuildErr?.errors) ? esbuildErr.errors[0] : undefined;
    return {
      syntaxOk: false,
      runtimeOk: false,
      logs: [],
      error: first?.text || esbuildErr?.message || 'Syntax error',
      line: first?.location?.line,
      column: first?.location?.column !== undefined ? first.location.column + 1 : undefined,
    };
  }

  // For JSX/TSX without a DOM or when only syntax check is needed
  if (loader === 'jsx' || loader === 'tsx' || !testCode.trim()) {
    return {
      syntaxOk: true,
      runtimeOk: true,
      logs: [`${loader.toUpperCase()} syntax check passed cleanly.`],
    };
  }

  const logs: string[] = [];
  const sandbox = Object.create(null) as Record<string, unknown>;
  sandbox.console = {
    log: (...args: unknown[]) => {
      if (logs.length < 30) {
        logs.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
      }
    },
    error: (...args: unknown[]) => {
      if (logs.length < 30) {
        logs.push(`[error] ${args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')}`);
      }
    },
    warn: (...args: unknown[]) => {
      if (logs.length < 30) {
        logs.push(`[warn] ${args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')}`);
      }
    },
  };
  sandbox.assert = (cond: unknown, msg = 'Assertion failed') => {
    if (!cond) throw new Error(msg);
  };
  sandbox.assertEqual = (actual: unknown, expected: unknown, msg?: string) => {
    const a = JSON.stringify(actual);
    const e = JSON.stringify(expected);
    if (a !== e) {
      throw new Error(msg || `Expected ${e}, got ${a}`);
    }
  };

  try {
    const ctx = vm.createContext(sandbox, {
      codeGeneration: { strings: false, wasm: false },
    });
    const script = new vm.Script(compiledJs, { filename: 'sandbox-check.js' });
    const ret = script.runInContext(ctx, { timeout: 400 });
    return {
      syntaxOk: true,
      runtimeOk: true,
      logs,
      returnValue: ret !== undefined ? String(ret).slice(0, 300) : undefined,
    };
  } catch (err) {
    return {
      syntaxOk: true,
      runtimeOk: false,
      logs,
      error: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
    };
  }
}
