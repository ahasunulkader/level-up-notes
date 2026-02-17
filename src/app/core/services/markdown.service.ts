import { Injectable } from '@angular/core';
import { marked } from 'marked';
import Prism from 'prismjs';
import 'prismjs/components/prism-markup';
import 'prismjs/components/prism-markup-templating';
import 'prismjs/components/prism-typescript';
import 'prismjs/components/prism-javascript';
import 'prismjs/components/prism-php';
import 'prismjs/components/prism-python';
import 'prismjs/components/prism-java';
import 'prismjs/components/prism-sql';
import 'prismjs/components/prism-bash';
import 'prismjs/components/prism-json';
import 'prismjs/components/prism-yaml';
import 'prismjs/components/prism-css';
import 'prismjs/components/prism-scss';
import 'prismjs/components/prism-nginx';

marked.setOptions({ gfm: true, breaks: true });

/**
 * Post-process HTML from marked: find all <code class="language-xxx"> blocks
 * and run Prism.highlight() on them so the output has colorful syntax tokens.
 */
function highlightCodeBlocks(html: string): string {
  return html.replace(
    /<pre><code class="language-([\w-]+)">([\s\S]*?)<\/code><\/pre>/g,
    (_match, lang: string, code: string) => {
      const grammar = Prism.languages[lang];
      if (!grammar) return _match;

      // Decode HTML entities that marked escaped
      const decoded = code
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'");

      const highlighted = Prism.highlight(decoded, grammar, lang);
      return `<pre class="language-${lang}"><code class="language-${lang}">${highlighted}</code></pre>`;
    }
  );
}

@Injectable({ providedIn: 'root' })
export class MarkdownService {
  async fetchAndParse(filePath: string): Promise<string> {
    const relative = filePath
      .split('/')
      .map((segment) => encodeURIComponent(segment))
      .join('/');
    const base = document.querySelector('base')?.href || document.baseURI;
    const absolutePath = new URL(relative, base).href;

    const response = await fetch(absolutePath);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${absolutePath}`);
    }
    const markdown = await response.text();
    const html = marked.parse(markdown) as string;
    return highlightCodeBlocks(html);
  }
}
