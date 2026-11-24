import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import type { AgentMode, ChatAttachment } from '../src/types/agent.ts';
import type { CodingIntentAnalysis, FollowUpCodeEditContext } from './codeVerifier.ts';

export type DeepIntentCategory =
  | 'website_artifact'
  | 'followup_edit'
  | 'bug_fix'
  | 'code_build'
  | 'luau_build'
  | 'prompt_engineering'
  | 'business_ops'
  | 'explain_or_qa'
  | 'general';

export type PromptComplexity = 'quick' | 'standard' | 'complex';

export interface PromptUnderstandingBrief {
  normalizedPrompt: string;
  intentCategory: DeepIntentCategory;
  primaryGoal: string;
  domain: string;
  responseLanguage: string;
  brandNames: string[];
  mustInclude: string[];
  mustPreserve: string[];
  mustAvoid: string[];
  stylePreferences: string[];
  assumptions: string[];
  targetOutputFormat: string;
  complexity: PromptComplexity;
  isPromptEngineering: boolean;
  isHinglishOrMultilingual: boolean;
  needsAiRefinement: boolean;
  refinedByAi: boolean;
  /** Semantic override when AI planner detects a follow-up edit that regex missed */
  semanticFollowUpEdit?: boolean;
  summaryLine: string;
}

const TYPO_REPLACEMENTS: Array<[RegExp, string]> = [
  [/\bwebstie\b|\bwebste\b|\bwebsit\b|\bwebsie\b|\bwebiste\b/gi, 'website'],
  [/\bportfolo\b|\bportflio\b|\bprotfolio\b|\bportfollio\b/gi, 'portfolio'],
  [/\bcalclator\b|\bcalculater\b|\bcalcuator\b|\bcalc\b/gi, 'calculator'],
  [/\bdashbord\b|\bdashbaord\b|\bdasboard\b/gi, 'dashboard'],
  [/\becomerce\b|\be-comerce\b|\becommmerce\b/gi, 'ecommerce'],
  [/\blandng\b|\blandingpg\b/gi, 'landing'],
  [/\bcoffie\b|\bcofee\b/gi, 'coffee'],
  [/\bresposive\b|\bresponive\b|\bresponsve\b/gi, 'responsive'],
  [/\bnavbr\b|\bnavabr\b/gi, 'navbar'],
  [/\bbtn\b/gi, 'button'],
  [/\bbtns\b/gi, 'buttons'],
  [/\bpg\b/gi, 'page'],
  [/\bmsg\b/gi, 'message'],
  [/\bpls\b|\bplz\b/gi, 'please'],
  [/\bw\/\b/gi, 'with'],
  [/\bw\/o\b/gi, 'without'],
  [/\banimaton\b|\banimatons\b/gi, 'animation'],
  [/\btheem\b|\bthme\b/gi, 'theme'],
  [/\bcolr\b|\bcolur\b/gi, 'color'],
  [/\bsecton\b|\bsectin\b/gi, 'section'],
  [/\bfuncton\b|\bfunciton\b/gi, 'function'],
  [/\bjavascirpt\b|\bjavasript\b/gi, 'javascript'],
  [/\btypscript\b|\btypescipt\b/gi, 'typescript'],
  [/\bpyhton\b|\bpyton\b/gi, 'python'],
  [/\broblx\b/gi, 'roblox'],
];

const HINGLISH_KEYWORDS_RE =
  /\b(bhai|yaar|bro|banao|bana\s*do|bna\s*do|bnao|karo|krdo|kar\s*do|kardo|chahiye|chahie|likho|likh\s*do|samjhao|batao|thik\s*karo|theek\s*karo|sahi\s*karo|badal\s*do|badlo|hatao|hata\s*do|jodo|jod\s*do|kaam\s*nahi\s*kar\s*raha|nahi\s*chal\s*raha|mera|meri|mere|ek\s+(?:site|website|app|portfolio|page|shop|store|game|bot|script|email|invoice)|ke\s+liye|me\s+likho|mein\s+likho|aur|mat\s+use|mat\s+lagao|naya|nayi|purana)\b/i;

const DEVANAGARI_RE = /[\u0900-\u097F]/;
const GUJARATI_RE = /[\u0A80-\u0AFF]/;

const HINGLISH_BUILD_VERBS_RE =
  /\b(banao|bana\s*do|bna\s*do|bnao|taiyar\s*karo|create\s*karo|make\s*karo|likh\s*do|likho)\b/i;

export const HINGLISH_EDIT_FIX_RE =
  /\b(thik\s*karo|theek\s*karo|sahi\s*karo|fix\s*karo|fix\s*krdo|badal\s*do|badlo|change\s*karo|change\s*krdo|krdo|kar\s*do|kardo|hatao|hata\s*do|remove\s*karo|add\s*karo|add\s*krdo|jodo|jod\s*do|kaam\s*nahi\s*kar\s*raha|nahi\s*chal\s*raha|chal\s*nahi\s*raha|toot\s*gaya|galat\s*hai|bigad\s*gaya|chota\s*karo|bada\s*karo|sundar\s*banao|better\s*karo|improve\s*karo)\b/i;

const NON_PROMPT_ENGINEERING_CODE_GUARD_RE =
  /\b(window\.prompt|command\s*prompt|shell\s*prompt|terminal\s*prompt|bash\s*prompt|cli\s*prompt|login\s*prompt|password\s*prompt|confirmation\s*prompt|install\s*prompt|pwa\s*prompt|prompt\s+dialog|prompt\s+modal|prompt\s+the\s+user|prompts?\s+the\s+user)\b/i;

const PROMPT_ENGINEERING_EXPLICIT_RE =
  /\b(?:(?:write|create|give|make|craft|generate|build|draft|prepare|provide|improve|enhance|optimize|rewrite|refine|engineer|design|suggest)\s+(?:me\s+)?(?:a\s+|an\s+|the\s+|some\s+|best\s+|good\s+|great\s+|detailed\s+|professional\s+|perfect\s+|strong\s+|effective\s+|better\s+|custom\s+|ready[- ]to[- ]use\s+)?(?:(?:ai|system|chatgpt|claude|gemini|midjourney|dall[- ]?e|image|video|coding|website|web|app|marketing|seo|writing|roleplay)\s+){0,3}prompts?\b|\b(?:a\s+|an\s+|the\s+|best\s+|good\s+|detailed\s+)?(?:ai|system|chatgpt|claude|gemini|midjourney|dall[- ]?e|image|video)\s+prompt\b|\bprompts?\s+(?:for|to\s+(?:make|build|create|generate|design|write|develop))\b|\b(?:prompt\s*(?:likho|likh\s*do|banao|bana\s*do|bna\s*do|do|de\s*do|chahiye|chahie|dedo|taiyar\s*karo))|(?:(?:ke\s+liye|ka|ki)\s+prompt\s*(?:likho|likh\s*do|banao|bana\s*do|do|de\s*do|chahiye|chahie)?)\b|\b(?:only|just)\s+(?:give|write|make|send)\s+(?:me\s+)?(?:a\s+|the\s+)?prompt\b)/i;

const EXPLICIT_DIRECT_BUILD_OVERRIDE_RE =
  /\b(?:and\s+(?:also\s+)?build\s+(?:the\s+)?(?:website|app|code)|actually\s+build\s+(?:the\s+)?(?:website|app)|write\s+(?:the\s+)?html\s+code)\b/i;

/**
 * Accurately distinguishes "write/give me a prompt (even if the prompt's topic is a website/app)"
 * from "build a website/app directly", supporting English, Hinglish, and casual shorthand.
 */
export function isPromptWritingRequest(raw: string): boolean {
  const text = (raw ?? '').trim();
  if (!text) return false;
  if (NON_PROMPT_ENGINEERING_CODE_GUARD_RE.test(text)) return false;
  if (EXPLICIT_DIRECT_BUILD_OVERRIDE_RE.test(text)) return false;
  return PROMPT_ENGINEERING_EXPLICIT_RE.test(text);
}

const DOMAIN_DETECTORS: Array<{ re: RegExp; label: string }> = [
  { re: /\b(coffee|cafe|espresso|roastery|bakery|tea\s*house)\b/i, label: 'Coffee Shop / Cafe' },
  { re: /\b(restaurant|bistro|pizza|burger|food\s*delivery|dining|kitchen|menu)\b/i, label: 'Restaurant & Food' },
  { re: /\b(portfolio|developer\s*site|designer\s*site|personal\s*site|resume|cv)\b/i, label: 'Personal Portfolio' },
  { re: /\b(gym|fitness|workout|yoga|trainer|crossfit|health\s*club)\b/i, label: 'Fitness & Gym' },
  { re: /\b(ecommerce|online\s*store|shop|storefront|shoes|sneakers|fashion|clothing|watch|jewel|boutique|marketplace)\b/i, label: 'E-Commerce Storefront' },
  { re: /\b(saas|dashboard|analytics|crm|admin\s*panel|metrics|kpi|telemetry|fintech|banking)\b/i, label: 'SaaS / Analytics Dashboard' },
  { re: /\b(agency|studio|consulting|startup|software\s*company|digital\s*marketing)\b/i, label: 'Agency / Startup' },
  { re: /\b(hotel|resort|travel|booking|flight|tour|hospitality|salon|spa|clinic|doctor|dental)\b/i, label: 'Booking & Hospitality' },
  { re: /\b(school|academy|course|learning|lms|edtech|tutor|quiz|study)\b/i, label: 'Education & Learning' },
  { re: /\b(real\s*estate|property|apartments|housing|broker)\b/i, label: 'Real Estate' },
  { re: /\b(game|arcade|puzzle|chess|snake|tetris|2048|flappy|platformer|rpg|shooter|casino)\b/i, label: 'Interactive Game' },
  { re: /\b(calculator|converter|timer|pomodoro|stopwatch|todo|kanban|notes|expense|budget|tracker|weather|music\s*player)\b/i, label: 'Interactive Utility App' },
  { re: /\b(roblox|luau|lua|startergui|screengui)\b/i, label: 'Roblox Luau Engineering' },
  { re: /\b(invoice|quotation|quote|gst|billing|customer\s*support|email|gmail|marketing\s*copy)\b/i, label: 'Business Operations' },
];

const FEATURE_EXTRACTORS: Array<{ re: RegExp; label: string }> = [
  { re: /\b(dark\s*\/?\s*light|light\s*\/?\s*dark|theme\s*(toggle|switch|switcher)|dark\s*mode\s*toggle)\b/i, label: 'Working dark/light theme toggle' },
  { re: /\b(search\s*(bar|box|input|filter)?|live\s*search|filter\s*(by|tabs?|buttons?))\b/i, label: 'Live search and category filters' },
  { re: /\b(cart|checkout|add\s*to\s*cart|shopping\s*bag|order\s*(now|button|drawer|summary))\b/i, label: 'Interactive cart / order workflow' },
  { re: /\b(pricing|plans?|tiers?|subscription|monthly\s*\/?\s*yearly)\b/i, label: 'Pricing plans section' },
  { re: /\b(menu|dishes|drinks|catalog|product\s*(grid|list|cards))\b/i, label: 'Interactive menu / product catalog' },
  { re: /\b(contact\s*form|booking\s*form|appointment|reserve|reservation|sign\s*up\s*form|login\s*form|inquiry\s*form)\b/i, label: 'Working validated form with submit feedback' },
  { re: /\b(testimonial|reviews?|ratings?|client\s*feedback)\b/i, label: 'Customer testimonials / reviews section' },
  { re: /\b(faq|frequently\s*asked|accordion)\b/i, label: 'Interactive FAQ accordion' },
  { re: /\b(gallery|showcase|case\s*stud|projects?\s*section)\b/i, label: 'Interactive project / gallery showcase' },
  { re: /\b(modal|popup|pop-up|dialog|drawer|quick\s*view)\b/i, label: 'Interactive modal or detail drawer' },
  { re: /\b(chart|graph|sparkline|analytics|stats|metrics)\b/i, label: 'Interactive data chart / visual metrics' },
  { re: /\b(localstorage|save\s*data|persist|remember\s*state)\b/i, label: 'localStorage state persistence' },
  { re: /\b(drag\s*(and|&|n)\s*drop|draggable|kanban)\b/i, label: 'Drag-and-drop interactivity' },
  { re: /\b(toast|notification)\b/i, label: 'Non-blocking toast notifications' },
  { re: /\b(mobile|responsive|phone)\b/i, label: 'Responsive mobile layout (390px+)' },
  { re: /\b(animation|animated|smooth\s*scroll|micro[- ]?interactions|hover\s*effects)\b/i, label: 'Smooth CSS animations & hover polish' },
  { re: /\b(gst|inr|rupees?|₹)\b/i, label: 'INR (₹) / GST-aware formatting' },
];

const STYLE_EXTRACTORS: Array<{ re: RegExp; label: string }> = [
  { re: /\b(dark\s*theme|dark\s*mode|dark\s*ui|obsidian|black\s*background|black\s*theme)\b/i, label: 'Dark theme palette' },
  { re: /\b(light\s*theme|light\s*mode|white\s*background|clean\s*white|bright)\b/i, label: 'Light / sunlit palette' },
  { re: /\b(minimal|minimalist|clean|apple[- ]style|swiss)\b/i, label: 'Minimalist high-whitespace design' },
  { re: /\b(luxury|premium|editorial|high[- ]end|elegant)\b/i, label: 'Luxury editorial aesthetic' },
  { re: /\b(glassmorphism|glass\s*effect|frosted|blur)\b/i, label: 'Glassmorphism surfaces' },
  { re: /\b(neon|cyberpunk|futuristic|sci[- ]fi|gaming)\b/i, label: 'Futuristic / high-contrast accent style' },
  { re: /\b(retro|vintage|brutalist|neo[- ]?brutalist|pixel)\b/i, label: 'Expressive retro/brutalist visual style' },
  { re: /\b(green|emerald|forest|mint|sage)\b/i, label: 'Green / emerald color palette' },
  { re: /\b(blue|cobalt|navy|ocean|sky|cyan)\b/i, label: 'Blue / ocean color palette' },
  { re: /\b(orange|terracotta|amber|warm|gold|brown|coffee\s*tones?)\b/i, label: 'Warm amber / terracotta tones' },
  { re: /\b(red|crimson|rose|coral)\b/i, label: 'Crimson / coral accent palette' },
  { re: /\b(pink|pastel|lavender)\b/i, label: 'Soft pastel / rose tones' },
];

export function normalizeUserPromptText(raw: string): string {
  let out = (raw ?? '').trim().replace(/\s+/g, ' ');
  for (const [re, replacement] of TYPO_REPLACEMENTS) {
    out = out.replace(re, replacement);
  }
  return out;
}

export function detectResponseLanguage(raw: string): {
  language: string;
  isHinglishOrMultilingual: boolean;
} {
  const text = (raw ?? '').trim();
  if (DEVANAGARI_RE.test(text) || /\bin\s+hindi\b|\bhindi\s+(me|mein)\b/i.test(text)) {
    return { language: 'Hindi', isHinglishOrMultilingual: true };
  }
  if (GUJARATI_RE.test(text) || /\bin\s+gujarati\b|\bgujarati\s+(me|mein)\b/i.test(text)) {
    return { language: 'Gujarati', isHinglishOrMultilingual: true };
  }
  if (HINGLISH_KEYWORDS_RE.test(text) || /\bhinglish\b/i.test(text)) {
    return { language: 'Hinglish (casual Hindi-English)', isHinglishOrMultilingual: true };
  }
  return { language: 'English', isHinglishOrMultilingual: false };
}

const BRAND_STOPWORDS = new Set([
  'a', 'an', 'the', 'my', 'our', 'your', 'this', 'that', 'it', 'me', 'us',
  'website', 'site', 'app', 'page', 'portfolio', 'store', 'shop', 'dashboard',
  'blog', 'menu', 'button', 'form', 'section', 'code', 'script', 'file',
  'dark', 'light', 'modern', 'clean', 'responsive', 'mobile', 'desktop',
  'with', 'and', 'for', 'without', 'using', 'like', 'in', 'on', 'to', 'of',
  'please', 'plz', 'bro', 'bhai', 'yaar', 'new', 'better', 'best', 'good',
  'chatgpt', 'claude', 'gemini', 'midjourney', 'roblox', 'html', 'css', 'js',
]);

export function extractBrandOrEntityNames(text: string): string[] {
  const found: string[] = [];
  const add = (rawName: string) => {
    const cleaned = rawName
      .trim()
      .replace(/^["'`“”‘’]+|["'`“”‘’]+$/g, '')
      .replace(/[.,!?;:]+$/, '')
      .trim();
    if (!cleaned || cleaned.length < 2 || cleaned.length > 40) return;
    if (BRAND_STOPWORDS.has(cleaned.toLowerCase())) return;
    if (!found.some((x) => x.toLowerCase() === cleaned.toLowerCase())) {
      found.push(cleaned);
    }
  };

  // Pattern 1: named / called / title / brand / name "Foo Bar" or FooBar
  const explicitNameRe =
    /\b(?:named|called|name\s*(?:is|:|=)?|brand\s*(?:name)?\s*(?:is|:|=)?|title\s*(?:to|is|:|=)?)\s+(?:["'“]([^"'”]{2,40})["'”]|([A-Z][A-Za-z0-9&'-]*(?:\s+[A-Z][A-Za-z0-9&'-]*){0,2})|([a-zA-Z][A-Za-z0-9&'-]{2,24}))/gi;
  let m: RegExpExecArray | null;
  while ((m = explicitNameRe.exec(text)) !== null) {
    const candidate = m[1] || m[2] || m[3] || '';
    // Stop before clause connectors like "with", "for", "and", "no"
    const trimmedClause = candidate.split(/\b(?:with|for|and|without|no|using|in|that|which)\b/i)[0].trim();
    add(trimmedClause);
  }

  // Pattern 2: "for Rahul" / "for BrewVibe" (capitalized proper noun after "for")
  const forProperNounRe = /\bfor\s+([A-Z][A-Za-z0-9&'-]{2,28}(?:\s+[A-Z][A-Za-z0-9&'-]{2,20})?)/g;
  while ((m = forProperNounRe.exec(text)) !== null) {
    const candidate = m[1] ?? '';
    if (!/^(My|Our|Your|The|A|An|Desktop|Mobile|Web|Roblox|Python|React|JavaScript|TypeScript)$/i.test(candidate)) {
      add(candidate);
    }
  }

  return found.slice(0, 4);
}

export function extractNegativeConstraints(text: string): string[] {
  const constraints: string[] = [];
  const add = (c: string) => {
    const clean = c.trim().replace(/[.,;!?]+$/, '').trim();
    if (clean.length < 3 || clean.length > 80) return;
    if (!constraints.some((x) => x.toLowerCase() === clean.toLowerCase())) {
      constraints.push(clean);
    }
  };

  const patterns = [
    /\b(?:no|without|avoid|skip|remove|exclude)\s+([a-z0-9][a-z0-9\s/-]{1,36}?)(?=\s*(?:,|;|\.|!|\?|\band\b|\bbut\b|\buse\b|\binstead\b|\bwith\b|$))/gi,
    /\b(?:don'?t|do\s+not|never)\s+(?:use|add|include|put|change|touch|remove|delete|rewrite)\s+([a-z0-9][a-z0-9\s/-]{1,42}?)(?=\s*(?:,|;|\.|!|\?|\band\b|\bbut\b|\buse\b|\binstead\b|$))/gi,
    /\b([a-z0-9][a-z0-9\s/-]{1,28})\s+mat\s+(?:use|lagao|rakho|daalo|change|hatao)\b/gi,
  ];

  for (const re of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const fullMatch = m[0]?.trim() ?? '';
      const target = m[1]?.trim() ?? '';
      if (!target || /^(problem|worries|need|doubt|idea|way)$/i.test(target)) continue;
      add(fullMatch);
    }
  }

  return constraints.slice(0, 6);
}

export function analyzePromptDeeply(input: {
  message: string;
  mode: AgentMode;
  attachments?: ChatAttachment[];
  codingIntent: CodingIntentAnalysis;
  followUpEdit: FollowUpCodeEditContext;
  historyCount?: number;
}): PromptUnderstandingBrief {
  const raw = (input.message ?? '').trim();
  const normalized = normalizeUserPromptText(raw);
  const { language: responseLanguage, isHinglishOrMultilingual } = detectResponseLanguage(raw);
  const brandNames = extractBrandOrEntityNames(raw);
  const mustAvoid = extractNegativeConstraints(normalized);

  const isPromptEngineering = isPromptWritingRequest(normalized);

  // Detect domain
  let domain = 'General Software & Productivity';
  for (const d of DOMAIN_DETECTORS) {
    if (d.re.test(normalized)) {
      domain = d.label;
      break;
    }
  }

  // Detect features explicitly requested
  const mustInclude: string[] = [];
  for (const f of FEATURE_EXTRACTORS) {
    if (f.re.test(normalized)) {
      // Skip if user explicitly negated it
      const negated = mustAvoid.some((neg) =>
        neg.toLowerCase().includes(f.label.toLowerCase().split(' ')[0])
      );
      if (!negated && !mustInclude.includes(f.label)) {
        mustInclude.push(f.label);
      }
    }
  }

  // Detect style preferences
  const stylePreferences: string[] = [];
  for (const s of STYLE_EXTRACTORS) {
    if (s.re.test(normalized)) {
      // Do not include a color preference if user explicitly said "no <color>"
      const colorWord = s.label.split(' ')[0].toLowerCase();
      const explicitlyExcluded = mustAvoid.some((neg) =>
        new RegExp(`\\b(no|without|avoid|don'?t|mat)\\b[^,.]*\\b${colorWord}\\b`, 'i').test(neg)
      );
      if (!explicitlyExcluded && !stylePreferences.includes(s.label)) {
        stylePreferences.push(s.label);
      }
    }
  }

  // Determine canonical intent category
  const hasHinglishWebsiteBuild =
    !isPromptEngineering &&
    !input.codingIntent.languages.includes('Luau') &&
    (HINGLISH_BUILD_VERBS_RE.test(raw) || /\b(website|site|portfolio|landing\s*page|store|shop|dashboard|web\s*app|calculator|game)\b/i.test(normalized)) &&
    /\b(website|site|portfolio|landing\s*page|store|shop|dashboard|web\s*app|ecommerce|cafe|coffee\s*shop|restaurant|gym|agency|resume|calculator|game|todo|kanban|tracker)\b/i.test(
      normalized
    );

  let intentCategory: DeepIntentCategory = 'general';
  if (isPromptEngineering) {
    intentCategory = 'prompt_engineering';
  } else if (input.followUpEdit.isFollowUpEdit) {
    intentCategory = 'followup_edit';
  } else if (input.codingIntent.isDebuggingTask || HINGLISH_EDIT_FIX_RE.test(raw)) {
    intentCategory = 'bug_fix';
  } else if (input.codingIntent.isLuaUiLibrary || input.codingIntent.kind === 'roblox_luau') {
    intentCategory = 'luau_build';
  } else if (input.codingIntent.isWebsiteOrFullStack || hasHinglishWebsiteBuild) {
    intentCategory = 'website_artifact';
  } else if (input.codingIntent.kind === 'explain_code') {
    intentCategory = 'explain_or_qa';
  } else if (input.codingIntent.isCodingTask || HINGLISH_BUILD_VERBS_RE.test(raw)) {
    intentCategory = 'code_build';
  } else if (input.codingIntent.kind === 'business_ops') {
    intentCategory = 'business_ops';
  } else if (/^(what|why|how|when|who|which|explain|compare|difference|is\s|can\s|does\s)/i.test(normalized)) {
    intentCategory = 'explain_or_qa';
  }

  // Determine complexity
  const wordCount = normalized.split(/\s+/).filter(Boolean).length;
  const isTrivialGreeting =
    wordCount <= 4 &&
    /^(hi|hey|hello|hlo|yo|sup|namaste|good\s*(morning|evening|afternoon)|thanks|thank\s*you|ok|okay|cool|test|ping)[\s!?.]*$/i.test(
      normalized
    );

  let complexity: PromptComplexity = 'standard';
  if (isTrivialGreeting || (intentCategory === 'explain_or_qa' && wordCount <= 12 && mustInclude.length === 0)) {
    complexity = 'quick';
  } else if (
    intentCategory === 'website_artifact' ||
    intentCategory === 'luau_build' ||
    intentCategory === 'followup_edit' ||
    intentCategory === 'bug_fix' ||
    mustInclude.length >= 2 ||
    mustAvoid.length >= 1 ||
    wordCount >= 18
  ) {
    complexity = 'complex';
  }

  // Target output format
  let targetOutputFormat = 'Clear, direct, well-structured Markdown response';
  if (intentCategory === 'prompt_engineering') {
    targetOutputFormat =
      'ONLY a dedicated copyable ```prompt:<Title> text prompt block (with optional 2-3 brief usage tips outside) — STRICTLY DO NOT build a website or output HTML/CSS/JS code';
  } else if (intentCategory === 'followup_edit') {
    const fileLabel = input.followUpEdit.previousFileNames[0] || 'index.html';
    targetOutputFormat = `Complete updated ${fileLabel} preserving all existing working code + 1-2 line root-cause/change summary`;
  } else if (intentCategory === 'website_artifact') {
    targetOutputFormat = input.codingIntent.wantsBackend
      ? 'Self-contained ```html:index.html interactive artifact + runnable backend server.js & package.json'
      : 'Single self-contained ```html:index.html interactive website artifact with bespoke UI, SVGs, and real JS interactivity';
  } else if (intentCategory === 'luau_build') {
    targetOutputFormat = 'Complete modular Roblox Luau script(s) in ```luau:<File>.luau with demo usage';
  } else if (intentCategory === 'code_build' || intentCategory === 'bug_fix') {
    targetOutputFormat = 'Complete runnable fixed/implemented code block(s) with concise root-cause or architecture note';
  } else if (intentCategory === 'business_ops') {
    targetOutputFormat = 'Ready-to-use business output (or ```draft block for emails) with exact verified figures';
  }

  // Primary goal sentence
  const brandLabel = brandNames.length > 0 ? ` for "${brandNames[0]}"` : '';
  let primaryGoal = normalized;
  if (intentCategory === 'prompt_engineering') {
    primaryGoal = `Craft a high-signal, copy-ready prompt${brandLabel} matching the user's target use case`;
  } else if (intentCategory === 'followup_edit') {
    primaryGoal = `Apply surgical in-place update to ${input.followUpEdit.previousFileNames[0] || 'existing code'}: ${normalized}`;
  } else if (intentCategory === 'website_artifact') {
    primaryGoal = `Build a complete, responsive interactive ${domain} website artifact${brandLabel}`;
  } else if (intentCategory === 'luau_build') {
    primaryGoal = `Engineer a complete Roblox Luau implementation${brandLabel}`;
  } else if (intentCategory === 'bug_fix') {
    primaryGoal = `Diagnose the exact root cause and deliver a complete working fix`;
  } else if (intentCategory === 'business_ops') {
    primaryGoal = `Deliver accurate, ready-to-send business output${brandLabel} in ${responseLanguage}`;
  }

  const mustPreserve = input.followUpEdit.isFollowUpEdit
    ? [
        `Preserve existing file(s): ${input.followUpEdit.previousFileNames.join(', ') || 'current artifact'}`,
        'Keep existing brand identity, layout, working sections, and features untouched unless explicitly asked to change them',
      ]
    : [];

  const assumptions: string[] = [];
  if (intentCategory === 'website_artifact' && wordCount <= 8) {
    assumptions.push(
      `Expanded brief prompt into a full multi-section ${domain} experience with realistic copy, interactive controls, and mobile responsiveness`
    );
  }
  if (isHinglishOrMultilingual && (intentCategory === 'website_artifact' || intentCategory === 'code_build')) {
    assumptions.push(
      'Explain concisely in user-friendly tone while keeping UI labels & code clean and idiomatic'
    );
  }

  // Decide when fast Layer-2 AI semantic planner adds real value (skip for trivial greetings or simple Q&A)
  const hasAttachments = Array.isArray(input.attachments) && input.attachments.length > 0;
  const hasAmbiguousPronounsWithHistory =
    (input.historyCount ?? 0) > 0 &&
    /\b(it|this|that|them|those|same|above|previous|iske|isko|ye|yeh|woh|wo|usko)\b/i.test(raw);
  const needsAiRefinement =
    !isTrivialGreeting &&
    raw.length >= 6 &&
    (complexity === 'complex' ||
      isHinglishOrMultilingual ||
      hasAmbiguousPronounsWithHistory ||
      (wordCount <= 8 && (intentCategory === 'website_artifact' || intentCategory === 'code_build' || intentCategory === 'followup_edit' || intentCategory === 'bug_fix')) ||
      hasAttachments);

  const summaryParts: string[] = [primaryGoal.slice(0, 90)];
  if (mustInclude.length > 0) {
    summaryParts.push(`${mustInclude.length} key requirement${mustInclude.length === 1 ? '' : 's'}`);
  }
  if (mustAvoid.length > 0) {
    summaryParts.push(`${mustAvoid.length} constraint${mustAvoid.length === 1 ? '' : 's'}`);
  }
  if (isHinglishOrMultilingual) {
    summaryParts.push(responseLanguage);
  }

  return {
    normalizedPrompt: normalized,
    intentCategory,
    primaryGoal,
    domain,
    responseLanguage,
    brandNames,
    mustInclude,
    mustPreserve,
    mustAvoid,
    stylePreferences,
    assumptions,
    targetOutputFormat,
    complexity,
    isPromptEngineering,
    isHinglishOrMultilingual,
    needsAiRefinement,
    refinedByAi: false,
    summaryLine: summaryParts.join(' · '),
  };
}

export interface AiSemanticPlanPayload {
  understoodGoal?: string;
  intentCategory?: string;
  domain?: string;
  responseLanguage?: string;
  brandNames?: string[];
  mustInclude?: string[];
  mustPreserve?: string[];
  mustAvoid?: string[];
  stylePreferences?: string[];
  assumptions?: string[];
  isFollowUpEdit?: boolean;
}

const VALID_CATEGORIES = new Set<DeepIntentCategory>([
  'website_artifact',
  'followup_edit',
  'bug_fix',
  'code_build',
  'luau_build',
  'prompt_engineering',
  'business_ops',
  'explain_or_qa',
  'general',
]);

function dedupeCleanList(items: Array<string | undefined | null>, max = 8): string[] {
  const out: string[] = [];
  for (const item of items) {
    if (typeof item !== 'string') continue;
    const clean = item.trim().slice(0, 140);
    if (!clean) continue;
    if (!out.some((existing) => existing.toLowerCase() === clean.toLowerCase())) {
      out.push(clean);
      if (out.length >= max) break;
    }
  }
  return out;
}

export function mergeAiUnderstandingBrief(
  base: PromptUnderstandingBrief,
  aiPayload: AiSemanticPlanPayload | null | undefined,
  hasPreviousCodeInHistory: boolean
): PromptUnderstandingBrief {
  if (!aiPayload || typeof aiPayload !== 'object') {
    return base;
  }

  const nextCategory: DeepIntentCategory =
    typeof aiPayload.intentCategory === 'string' &&
    VALID_CATEGORIES.has(aiPayload.intentCategory as DeepIntentCategory)
      ? (aiPayload.intentCategory as DeepIntentCategory)
      : base.intentCategory;

  const understoodGoal =
    typeof aiPayload.understoodGoal === 'string' && aiPayload.understoodGoal.trim().length >= 6
      ? aiPayload.understoodGoal.trim().slice(0, 220)
      : base.primaryGoal;

  const domain =
    typeof aiPayload.domain === 'string' && aiPayload.domain.trim().length >= 2
      ? aiPayload.domain.trim().slice(0, 60)
      : base.domain;

  const responseLanguage =
    typeof aiPayload.responseLanguage === 'string' && aiPayload.responseLanguage.trim().length >= 2
      ? aiPayload.responseLanguage.trim().slice(0, 40)
      : base.responseLanguage;

  const brandNames = dedupeCleanList(
    [...(Array.isArray(aiPayload.brandNames) ? aiPayload.brandNames : []), ...base.brandNames],
    5
  );
  const mustInclude = dedupeCleanList(
    [...(Array.isArray(aiPayload.mustInclude) ? aiPayload.mustInclude : []), ...base.mustInclude],
    8
  );
  const mustPreserve = dedupeCleanList(
    [...(Array.isArray(aiPayload.mustPreserve) ? aiPayload.mustPreserve : []), ...base.mustPreserve],
    5
  );
  const mustAvoid = dedupeCleanList(
    [...(Array.isArray(aiPayload.mustAvoid) ? aiPayload.mustAvoid : []), ...base.mustAvoid],
    6
  );
  const stylePreferences = dedupeCleanList(
    [...(Array.isArray(aiPayload.stylePreferences) ? aiPayload.stylePreferences : []), ...base.stylePreferences],
    5
  );
  const assumptions = dedupeCleanList(
    [...(Array.isArray(aiPayload.assumptions) ? aiPayload.assumptions : []), ...base.assumptions],
    4
  );

  const isPromptEngineering =
    base.isPromptEngineering || nextCategory === 'prompt_engineering';

  const semanticFollowUpEdit = isPromptEngineering
    ? false
    : hasPreviousCodeInHistory && typeof aiPayload.isFollowUpEdit === 'boolean'
      ? aiPayload.isFollowUpEdit
      : undefined;

  const effectiveCategory: DeepIntentCategory = isPromptEngineering
    ? 'prompt_engineering'
    : semanticFollowUpEdit === true
      ? 'followup_edit'
      : nextCategory;

  const targetOutputFormat = isPromptEngineering
    ? 'ONLY a dedicated copyable ```prompt:<Title> text prompt block (with optional 2-3 brief usage tips outside) — STRICTLY DO NOT build a website or output HTML/CSS/JS code'
    : base.targetOutputFormat;

  const summaryParts: string[] = [understoodGoal.slice(0, 95)];
  if (mustInclude.length > 0) {
    summaryParts.push(`${mustInclude.length} verified requirement${mustInclude.length === 1 ? '' : 's'}`);
  }
  if (mustAvoid.length > 0) {
    summaryParts.push(`${mustAvoid.length} constraint${mustAvoid.length === 1 ? '' : 's'}`);
  }

  return {
    ...base,
    intentCategory: effectiveCategory,
    primaryGoal: understoodGoal,
    domain,
    responseLanguage,
    brandNames,
    mustInclude,
    mustPreserve,
    mustAvoid,
    stylePreferences,
    assumptions,
    targetOutputFormat,
    isPromptEngineering,
    semanticFollowUpEdit,
    refinedByAi: true,
    summaryLine: summaryParts.join(' · '),
  };
}

/**
 * Layer-2 fast semantic prompt understanding pass using `gemini-3.1-flash-lite`
 * with `ThinkingLevel.MINIMAL` and strict JSON `responseSchema`.
 * Resolves typos, Hinglish/multilingual phrasing, implicit references ("it/that/the hero"),
 * brand names, negative constraints, and concrete checklist requirements in <1s.
 * Fails open cleanly to Layer-1 brief on timeout or API quota pressure.
 */
export async function refinePromptUnderstandingWithAI(
  ai: GoogleGenAI,
  input: {
    rawMessage: string;
    history: Array<{ role: 'user' | 'assistant'; content: string }>;
    baseBrief: PromptUnderstandingBrief;
    hasPreviousCodeInHistory: boolean;
    previousFileNames: string[];
  }
): Promise<PromptUnderstandingBrief> {
  if (!input.baseBrief.needsAiRefinement) {
    return input.baseBrief;
  }

  // Compact recent context (last 4 turns, summarized so tokens stay tiny & fast)
  const recentHistorySnippet = input.history
    .slice(-4)
    .map((m) => {
      const compact = m.content.replace(/```[\s\S]*?```/g, '[code artifact omitted]').trim();
      return `${m.role.toUpperCase()}: ${compact.slice(0, 260)}`;
    })
    .join('\n');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4500);

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3.1-flash-lite',
      contents: [
        recentHistorySnippet ? `Recent conversation:\n${recentHistorySnippet}\n` : '',
        input.hasPreviousCodeInHistory
          ? `Previous code files in this chat: ${input.previousFileNames.join(', ') || 'index.html'}\n`
          : '',
        `Latest user message (may contain typos, shorthand, slang, or Hinglish):\n"""${input.rawMessage.slice(0, 1800)}"""`,
      ]
        .filter(Boolean)
        .join('\n'),
      config: {
        systemInstruction: `You are a Principal Prompt Understanding & Requirements Analyst.
Your job is to deeply understand what the user REALLY wants — even if their message is 1 line, has typos, uses Hinglish/Hindi/slang, or refers to earlier messages with pronouns like "it", "this", "that button", or "fix it".
Output ONLY valid JSON matching the schema:
- understoodGoal: 1 crystal-clear English sentence capturing the exact user intent (resolving typos, Hinglish, and pronouns from conversation history).
- intentCategory: one of website_artifact, followup_edit, bug_fix, code_build, luau_build, prompt_engineering, business_ops, explain_or_qa, general. Use "prompt_engineering" ONLY when the user asks you to write/craft/improve an AI prompt for them to copy. Use "followup_edit" when modifying/fixing code already created earlier in this chat.
- domain: concise domain name (e.g., "Coffee Shop", "Portfolio", "SaaS Analytics", "Roblox Luau").
- responseLanguage: the language the user expects prose in (e.g., "English", "Hinglish", "Hindi", "Gujarati").
- brandNames: exact brand/app/person names mentioned by the user (empty array if none).
- mustInclude: 3 to 7 concrete, specific features/sections/behaviors required to fully satisfy the user's request (expand brief prompts with smart, domain-authentic must-haves).
- mustPreserve: if modifying previous code, list what existing parts/branding/features MUST remain intact.
- mustAvoid: explicit negative constraints mentioned by the user (e.g., "no purple colors", "no login screen", "don't remove navbar").
- stylePreferences: explicit or clearly implied visual/tone cues (e.g., "dark mode", "emerald green accent", "minimalist").
- assumptions: 1 to 3 smart defaults made for unspecified details so the AI executes immediately without asking unnecessary questions.
- isFollowUpEdit: true ONLY if the user is fixing, tweaking, styling, or adding to code already built earlier in this conversation; false if starting fresh or no previous code exists.`,
        thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL },
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            understoodGoal: { type: Type.STRING },
            intentCategory: { type: Type.STRING },
            domain: { type: Type.STRING },
            responseLanguage: { type: Type.STRING },
            brandNames: { type: Type.ARRAY, items: { type: Type.STRING } },
            mustInclude: { type: Type.ARRAY, items: { type: Type.STRING } },
            mustPreserve: { type: Type.ARRAY, items: { type: Type.STRING } },
            mustAvoid: { type: Type.ARRAY, items: { type: Type.STRING } },
            stylePreferences: { type: Type.ARRAY, items: { type: Type.STRING } },
            assumptions: { type: Type.ARRAY, items: { type: Type.STRING } },
            isFollowUpEdit: { type: Type.BOOLEAN },
          },
          required: ['understoodGoal', 'intentCategory', 'mustInclude', 'isFollowUpEdit'],
        },
        abortSignal: controller.signal,
      },
    });

    const rawJson = (response.text ?? '').trim();
    if (!rawJson) return input.baseBrief;
    const parsed = JSON.parse(rawJson) as AiSemanticPlanPayload;
    return mergeAiUnderstandingBrief(input.baseBrief, parsed, input.hasPreviousCodeInHistory);
  } catch {
    // Fail open cleanly: never block or fail a user turn if fast planner times out or hits quota
    return input.baseBrief;
  } finally {
    clearTimeout(timer);
  }
}

export function formatPromptBriefForSystemPrompt(brief: PromptUnderstandingBrief): string {
  const lines: string[] = [
    '## VERIFIED PROMPT UNDERSTANDING BRIEF (EXECUTION CONTRACT — FOLLOW STRICTLY)',
    `- **Understood Goal**: ${brief.primaryGoal}`,
    `- **Intent Category**: ${brief.intentCategory} | **Domain**: ${brief.domain} | **Complexity**: ${brief.complexity.toUpperCase()}`,
    `- **Target Output Format**: ${brief.targetOutputFormat}`,
    `- **Response Language**: Match the user naturally (${brief.responseLanguage}).${
      brief.isHinglishOrMultilingual &&
      (brief.intentCategory === 'website_artifact' ||
        brief.intentCategory === 'code_build' ||
        brief.intentCategory === 'followup_edit')
        ? ' Keep UI copy clean and domain-appropriate unless the user explicitly asked for localized UI text.'
        : ''
    }`,
  ];

  if (brief.brandNames.length > 0) {
    lines.push(
      `- **Exact Brand / Entity Names (MUST USE EXACT SPELLING)**: ${brief.brandNames.join(', ')}`
    );
  }
  if (brief.mustInclude.length > 0) {
    lines.push(
      `- **Must-Satisfy Requirements Checklist**:\n${brief.mustInclude
        .map((item, i) => `  ${i + 1}. ${item}`)
        .join('\n')}`
    );
  }
  if (brief.stylePreferences.length > 0) {
    lines.push(`- **Visual / Tone Preferences**: ${brief.stylePreferences.join('; ')}`);
  }
  if (brief.mustPreserve.length > 0) {
    lines.push(`- **Must Preserve Untouched**: ${brief.mustPreserve.join('; ')}`);
  }
  if (brief.mustAvoid.length > 0) {
    lines.push(
      `- **Strict Negative Constraints (DO NOT VIOLATE)**: ${brief.mustAvoid.join('; ')}`
    );
  }
  if (brief.assumptions.length > 0) {
    lines.push(`- **Smart Defaults Applied (Do NOT stall asking about these)**: ${brief.assumptions.join('; ')}`);
  }

  return lines.join('\n');
}
