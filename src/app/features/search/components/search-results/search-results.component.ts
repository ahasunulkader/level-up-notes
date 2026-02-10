import { Component, inject, OnInit, OnDestroy, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { Subscription } from 'rxjs';
import { SearchService, SearchResult } from '../../../../core/services/search.service';

@Component({
  selector: 'app-search-results',
  standalone: true,
  imports: [RouterLink],
  template: `
    <div class="search-page">
      <h1>Search Results</h1>
      @if (query()) {
        <p class="search-info">
          {{ results().length }} result{{ results().length !== 1 ? 's' : '' }} for
          "<strong>{{ query() }}</strong>"
        </p>
      }

      @if (loading()) {
        <div class="loading">Searching...</div>
      } @else if (results().length === 0 && query()) {
        <div class="no-results">
          <p>No results found. Try a different search term.</p>
        </div>
      } @else {
        <div class="results-list">
          @for (result of results(); track result.route) {
            <a class="result-card" [routerLink]="'/' + result.route">
              <div class="result-breadcrumb">{{ result.breadcrumb }}</div>
              <h3>{{ result.label }}</h3>
              @for (snippet of result.contentMatches; track $index) {
                <p class="result-snippet">...{{ snippet }}...</p>
              }
              <span class="match-type badge-{{ result.matchType }}">{{ result.matchType }}</span>
            </a>
          }
        </div>
      }
    </div>
  `,
  styles: [`
    .search-page { max-width: 800px; }
    h1 {
      font-size: 24px;
      color: #1e293b;
      margin-bottom: 8px;
    }
    .search-info {
      color: #64748b;
      margin-bottom: 24px;
      font-size: 14px;
    }
    .loading, .no-results {
      padding: 40px 0;
      color: #94a3b8;
      text-align: center;
    }
    .results-list {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .result-card {
      display: block;
      background: #ffffff;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      padding: 16px 20px;
      text-decoration: none;
      transition: border-color 0.2s, box-shadow 0.2s;
      position: relative;
    }
    .result-card:hover {
      border-color: #2563eb;
      box-shadow: 0 2px 8px rgba(37,99,235,0.08);
    }
    .result-breadcrumb {
      font-size: 12px;
      color: #94a3b8;
      margin-bottom: 4px;
    }
    .result-card h3 {
      font-size: 16px;
      color: #1e293b;
      margin-bottom: 8px;
    }
    .result-snippet {
      font-size: 13px;
      color: #64748b;
      line-height: 1.5;
      margin-bottom: 4px;
      overflow: hidden;
      text-overflow: ellipsis;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
    }
    .match-type {
      position: absolute;
      top: 16px;
      right: 16px;
      font-size: 10px;
      padding: 2px 8px;
      border-radius: 10px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .badge-both { background: #dcfce7; color: #16a34a; }
    .badge-title { background: #dbeafe; color: #2563eb; }
    .badge-content { background: #ffedd5; color: #ea580c; }
  `],
})
export class SearchResultsComponent implements OnInit, OnDestroy {
  private route = inject(ActivatedRoute);
  private searchService = inject(SearchService);

  query = signal('');
  results = signal<SearchResult[]>([]);
  loading = signal(false);

  private sub?: Subscription;

  ngOnInit(): void {
    this.sub = this.route.queryParams.subscribe((params) => {
      const q = params['q'] || '';
      this.query.set(q);
      if (q) this.performSearch(q);
    });
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
  }

  private async performSearch(query: string): Promise<void> {
    this.loading.set(true);
    try {
      const results = await this.searchService.search(query);
      this.results.set(results);
    } catch {
      this.results.set([]);
    }
    this.loading.set(false);
  }
}
