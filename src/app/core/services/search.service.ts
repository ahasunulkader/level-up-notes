import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { NavigationItem } from '../models/navigation.model';
import { NavigationService } from './navigation.service';

export interface SearchResult {
  label: string;
  route: string;
  breadcrumb: string;
  contentMatches: string[];
  matchType: 'title' | 'content' | 'both';
}

@Injectable({ providedIn: 'root' })
export class SearchService {
  constructor(
    private http: HttpClient,
    private navService: NavigationService
  ) {}

  async search(query: string): Promise<SearchResult[]> {
    if (!query || query.trim().length < 2) return [];

    const term = query.toLowerCase().trim();
    const results: SearchResult[] = [];
    const items = this.flattenNavigation(this.navService.navigation());

    for (const item of items) {
      if (!item.route) continue;

      const titleMatch = item.label.toLowerCase().includes(term);
      let contentMatches: string[] = [];

      try {
        const path = '/assets/docs/' + item.route.split('/').map((s) => encodeURIComponent(s)).join('/') + '.md';
        const content = await firstValueFrom(
          this.http.get(path, { responseType: 'text' })
        );

        if (content) {
          const lines = content.split('\n');
          for (let i = 0; i < lines.length; i++) {
            if (lines[i].toLowerCase().includes(term)) {
              const start = Math.max(0, i - 1);
              const end = Math.min(lines.length, i + 2);
              const snippet = lines
                .slice(start, end)
                .join('\n')
                .substring(0, 200);
              contentMatches.push(snippet);
              if (contentMatches.length >= 3) break;
            }
          }
        }
      } catch {
        // File not accessible, skip content search
      }

      if (titleMatch || contentMatches.length > 0) {
        results.push({
          label: item.label,
          route: item.route,
          breadcrumb: item.breadcrumb || '',
          contentMatches,
          matchType:
            titleMatch && contentMatches.length > 0
              ? 'both'
              : titleMatch
                ? 'title'
                : 'content',
        });
      }
    }

    return results.sort((a, b) => {
      const order = { both: 0, title: 1, content: 2 };
      return order[a.matchType] - order[b.matchType];
    });
  }

  private flattenNavigation(
    items: NavigationItem[],
    breadcrumb = ''
  ): { label: string; route: string; breadcrumb: string }[] {
    const result: { label: string; route: string; breadcrumb: string }[] = [];
    for (const item of items) {
      const crumb = breadcrumb ? `${breadcrumb} / ${item.label}` : item.label;
      if (item.route) {
        result.push({ label: item.label, route: item.route, breadcrumb: crumb });
      }
      if (item.children) {
        result.push(...this.flattenNavigation(item.children, crumb));
      }
    }
    return result;
  }
}
