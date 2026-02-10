import { Injectable } from '@angular/core';
import { marked } from 'marked';

marked.setOptions({ gfm: true, breaks: true });

@Injectable({ providedIn: 'root' })
export class MarkdownService {
  async fetchAndParse(filePath: string): Promise<string> {
    const absolutePath = '/' + filePath
      .split('/')
      .map((segment) => encodeURIComponent(segment))
      .join('/');

    const response = await fetch(absolutePath);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${absolutePath}`);
    }
    const markdown = await response.text();
    return marked.parse(markdown) as string;
  }
}
