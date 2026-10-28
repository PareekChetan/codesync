import { cpp } from '@codemirror/lang-cpp';
import { css } from '@codemirror/lang-css';
import { go } from '@codemirror/lang-go';
import { html } from '@codemirror/lang-html';
import { java } from '@codemirror/lang-java';
import { javascript } from '@codemirror/lang-javascript';
import { markdown } from '@codemirror/lang-markdown';
import { python } from '@codemirror/lang-python';
import type { Extension } from '@codemirror/state';
import type { Language } from './api';

/** Kept separate from languages.ts so the dashboard doesn't download every grammar. */
export function languageExtension(language: Language): Extension {
  switch (language) {
    case 'javascript':
      return javascript();
    case 'typescript':
      return javascript({ typescript: true });
    case 'python':
      return python();
    case 'java':
      return java();
    case 'cpp':
      return cpp();
    case 'go':
      return go();
    case 'html':
      return html();
    case 'css':
      return css();
    case 'markdown':
      return markdown();
  }
}

