import { extractProjectFiles } from './messageParser.ts';

export interface FollowUpSuggestion {
  label: string;
  prompt: string;
}

/**
 * Generates up to 3 high-signal, domain-aware follow-up prompt chips
 * for a completed assistant response (similar to Claude / Gemini / ChatGPT).
 */
export function buildFollowUpSuggestions(
  assistantContent: string,
  userPrompt = ''
): FollowUpSuggestion[] {
  const content = typeof assistantContent === 'string' ? assistantContent : '';
  const combined = `${userPrompt}\n${content}`.toLowerCase();
  if (!content.trim()) return [];

  const files = extractProjectFiles(content);
  const langs = new Set(files.map((f) => f.language.toLowerCase()));

  // 1. Roblox / Lua / Luau UI Library or scripts
  if (
    langs.has('lua') ||
    langs.has('luau') ||
    /\b(luau|roblox|screengui|tweenservice)\b/.test(combined)
  ) {
    return [
      {
        label: 'Add Keybind & ColorPicker controls',
        prompt:
          'Upgrade the Luau UI library to add a full HSV ColorPicker control, Keybind listener with conflict guard, and JSON config save/load presets.',
      },
      {
        label: 'Add Light & Dark theme switcher',
        prompt:
          'Add a live Theme switcher (Midnight Dark, Slate Light, Ocean Accent) with smooth TweenService transitions across every open window and component.',
      },
      {
        label: 'Audit memory & connection cleanup',
        prompt:
          'Review every RBXScriptConnection, Tween, and ScreenGui lifecycle path in this Luau code and harden the Maid cleanup to prevent leaks.',
      },
    ];
  }

  // 2. Full-stack website / HTML / React / CSS
  if (
    langs.has('html') ||
    langs.has('tsx') ||
    langs.has('jsx') ||
    /\b(portfolio|website|landing page|express|dashboard)\b/.test(combined)
  ) {
    return [
      {
        label: 'Add live analytics & filtering',
        prompt:
          'Enhance this web app with interactive filtering, live search highlighting, and a clean visual stats section while keeping mobile responsive.',
      },
      {
        label: 'Add database persistence',
        prompt:
          'Upgrade the Express backend to persist all records cleanly with validation, pagination, search query params, and proper error status codes.',
      },
      {
        label: 'Audit accessibility & mobile UX',
        prompt:
          'Audit this UI for WCAG AA contrast, keyboard navigation, focus states, and 390px mobile layout polish, then return the improved code.',
      },
    ];
  }

  // 3. Email draft / Business communication
  if (/```draft/i.test(content) || /\b(gmail|email|invoice|quote|customer)\b/.test(combined)) {
    return [
      {
        label: 'Make tone warmer & shorter',
        prompt: 'Rewrite the email draft so it is warmer, shorter, and easier to scan on mobile.',
      },
      {
        label: 'Translate to Hindi',
        prompt: 'Translate this email draft into natural, polite business Hindi keeping all numbers exact.',
      },
      {
        label: 'Translate to Gujarati',
        prompt: 'Translate this email draft into natural, polite business Gujarati keeping all numbers exact.',
      },
    ];
  }

  // 4. General code / debugging / backend / Python / TS
  if (files.length > 0 || /```/.test(content)) {
    return [
      {
        label: 'Write unit tests',
        prompt:
          'Write a thorough unit test suite covering happy paths, invalid inputs, and edge cases for the code above.',
      },
      {
        label: 'Optimize & harden edge cases',
        prompt:
          'Review the code above for performance bottlenecks, null/undefined edge cases, and security issues, then provide the hardened version.',
      },
      {
        label: 'Explain architecture simply',
        prompt:
          'Give me a clear, concise breakdown of how the core parts of this code work together and how to extend it safely.',
      },
    ];
  }

  // 5. General Q&A / strategy
  return [
    {
      label: 'Go deeper with examples',
      prompt: 'Expand on the most important point above with a concrete, production-ready example.',
    },
    {
      label: 'Turn into an action plan',
      prompt: 'Turn this into a crisp step-by-step implementation checklist prioritized by impact.',
    },
  ];
}
