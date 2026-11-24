import Prism from 'prismjs';
import 'prismjs/components/prism-clike';
import 'prismjs/components/prism-markup';
import 'prismjs/components/prism-css';
import 'prismjs/components/prism-javascript';
import 'prismjs/components/prism-typescript';
import 'prismjs/components/prism-jsx';
import 'prismjs/components/prism-tsx';
import 'prismjs/components/prism-lua';
import 'prismjs/components/prism-python';
import 'prismjs/components/prism-json';
import 'prismjs/components/prism-bash';
import 'prismjs/components/prism-sql';
import 'prismjs/components/prism-yaml';
import 'prismjs/components/prism-markdown';
import 'prismjs/components/prism-c';
import 'prismjs/components/prism-cpp';
import 'prismjs/components/prism-csharp';
import 'prismjs/components/prism-go';
import 'prismjs/components/prism-rust';
import 'prismjs/components/prism-java';
import 'prismjs/components/prism-diff';

export interface HighlightSpan {
  text: string;
  tokenType: string | null;
}

export type HighlightedLine = HighlightSpan[];

const LANGUAGE_ALIASES: Record<string, string> = {
  html: 'markup',
  htm: 'markup',
  xml: 'markup',
  svg: 'markup',
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  ts: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  luau: 'lua',
  py: 'python',
  sh: 'bash',
  shell: 'bash',
  zsh: 'bash',
  yml: 'yaml',
  md: 'markdown',
  cs: 'csharp',
  'c#': 'csharp',
  'c++': 'cpp',
  cc: 'cpp',
  cxx: 'cpp',
  rs: 'rust',
  golang: 'go',
  jsonc: 'json',
};

const DISPLAY_LABELS: Record<string, string> = {
  markup: 'HTML',
  html: 'HTML',
  css: 'CSS',
  javascript: 'JavaScript',
  js: 'JavaScript',
  typescript: 'TypeScript',
  ts: 'TypeScript',
  jsx: 'JSX',
  tsx: 'TSX',
  lua: 'Lua',
  luau: 'Luau',
  python: 'Python',
  py: 'Python',
  json: 'JSON',
  bash: 'Bash',
  sh: 'Shell',
  sql: 'SQL',
  yaml: 'YAML',
  markdown: 'Markdown',
  cpp: 'C++',
  csharp: 'C#',
  go: 'Go',
  rust: 'Rust',
  java: 'Java',
  diff: 'Diff',
};

export function normalizePrismLanguage(rawLanguage: string): string {
  const cleaned = (rawLanguage || '').trim().toLowerCase();
  if (!cleaned) return 'plaintext';
  const mapped = LANGUAGE_ALIASES[cleaned] ?? cleaned;
  return Prism.languages[mapped] ? mapped : 'plaintext';
}

export function getDisplayLanguageLabel(rawLanguage: string): string {
  const cleaned = (rawLanguage || '').trim().toLowerCase();
  if (!cleaned) return 'Text';
  return DISPLAY_LABELS[cleaned] ?? cleaned.toUpperCase();
}

function mapPrismTokenType(type: string, alias?: string | string[]): string {
  const aliases = Array.isArray(alias) ? alias : alias ? [alias] : [];
  const primary = type.toLowerCase();

  if (primary === 'comment' || primary === 'prolog' || primary === 'doctype' || primary === 'cdata') {
    return 'comment';
  }
  if (
    primary === 'string' ||
    primary === 'char' ||
    primary === 'template-string' ||
    primary === 'attr-value' ||
    aliases.includes('string')
  ) {
    return 'string';
  }
  if (primary === 'keyword' || primary === 'atrule' || primary === 'important') {
    return 'keyword';
  }
  if (primary === 'boolean' || primary === 'constant' || primary === 'symbol' || primary === 'nil') {
    return 'boolean';
  }
  if (primary === 'number' || primary === 'hexcode' || primary === 'unit') {
    return 'number';
  }
  if (primary === 'function' || primary === 'method' || aliases.includes('function')) {
    return 'function';
  }
  if (primary === 'class-name' || primary === 'maybe-class-name' || primary === 'builtin') {
    return 'class-name';
  }
  if (primary === 'tag' || primary === 'selector') {
    return 'tag';
  }
  if (primary === 'attr-name' || primary === 'property' || primary === 'property-access') {
    return 'property';
  }
  if (primary === 'operator' || primary === 'arrow' || primary === 'entity') {
    return 'operator';
  }
  if (primary === 'punctuation') {
    return 'punctuation';
  }
  if (primary === 'regex') {
    return 'regex';
  }
  if (primary === 'variable' || primary === 'parameter') {
    return 'variable';
  }
  if (primary === 'inserted') {
    return 'inserted';
  }
  if (primary === 'deleted') {
    return 'deleted';
  }
  return 'plain';
}

function flattenPrismTokens(
  tokens: Array<string | Prism.Token>,
  inheritedType: string | null,
  out: HighlightSpan[]
): void {
  for (const token of tokens) {
    if (typeof token === 'string') {
      if (token.length > 0) {
        out.push({ text: token, tokenType: inheritedType });
      }
      continue;
    }

    const mappedType = mapPrismTokenType(token.type, token.alias);
    const effectiveType = mappedType === 'plain' ? inheritedType : mappedType;

    if (typeof token.content === 'string') {
      if (token.content.length > 0) {
        out.push({ text: token.content, tokenType: effectiveType });
      }
    } else if (Array.isArray(token.content)) {
      flattenPrismTokens(token.content, effectiveType, out);
    } else if (token.content) {
      flattenPrismTokens([token.content], effectiveType, out);
    }
  }
}

/**
 * Synchronously tokenizes code via Prism.js into line-split React-safe spans.
 * Zero innerHTML usage — safe against XSS and fast enough for live token streaming.
 */
export function tokenizeCodeLines(code: string, rawLanguage: string): HighlightedLine[] {
  const safeCode = typeof code === 'string' ? code.replace(/\r\n/g, '\n') : '';
  const prismLang = normalizePrismLanguage(rawLanguage);
  const grammar = prismLang !== 'plaintext' ? Prism.languages[prismLang] : undefined;

  if (!grammar) {
    return safeCode.split('\n').map((line) => (line ? [{ text: line, tokenType: null }] : []));
  }

  const rawTokens = Prism.tokenize(safeCode, grammar);
  const flatSpans: HighlightSpan[] = [];
  flattenPrismTokens(rawTokens, null, flatSpans);

  const lines: HighlightedLine[] = [[]];

  for (const span of flatSpans) {
    const parts = span.text.split('\n');
    for (let i = 0; i < parts.length; i += 1) {
      if (i > 0) {
        lines.push([]);
      }
      const chunk = parts[i];
      if (chunk.length > 0) {
        const currentLine = lines[lines.length - 1];
        const prev = currentLine[currentLine.length - 1];
        if (prev && prev.tokenType === span.tokenType) {
          prev.text += chunk;
        } else {
          currentLine.push({ text: chunk, tokenType: span.tokenType });
        }
      }
    }
  }

  return lines;
}
