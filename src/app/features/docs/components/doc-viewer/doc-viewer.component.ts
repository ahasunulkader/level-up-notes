import { Component, inject, signal, OnInit, OnDestroy } from '@angular/core';
import { Router, NavigationEnd } from '@angular/router';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { filter, Subscription } from 'rxjs';
import { MarkdownService } from '../../../../core/services/markdown.service';
import { NavigationService } from '../../../../core/services/navigation.service';
import { TocComponent } from '../../../../shared/components/toc/toc.component';

@Component({
  selector: 'app-doc-viewer',
  standalone: true,
  imports: [TocComponent],
  template: `
    <div class="doc-viewer-layout">
      <div class="doc-viewer">
        @if (loading()) {
          <div class="loading">
            <div class="spinner"></div>
            <p>Loading document...</p>
          </div>
        } @else if (error()) {
          <div class="error">
            <h2>&#128533; Document Not Found</h2>
            <p>The requested document could not be loaded.</p>
            <p class="error-path">Path: {{ currentPath() }}</p>
            <p class="error-detail">{{ errorDetail() }}</p>
          </div>
        } @else {
          <article class="markdown-body" [innerHTML]="safeHtml()" (click)="handleClick($event)"></article>
        }
      </div>
      <app-toc [htmlContent]="rawHtml()" />
    </div>
  `,
  styles: [`
    .doc-viewer-layout { display: flex; gap: 48px; }
    .doc-viewer { flex: 1; min-width: 0; }
    .loading { display: flex; flex-direction: column; align-items: center; padding: 60px 0; color: #94a3b8; gap: 12px; }
    .spinner { width: 32px; height: 32px; border: 3px solid #e2e8f0; border-top-color: #2563eb; border-radius: 50%; animation: spin 0.8s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }
    .error { text-align: center; padding: 60px 0; }
    .error h2 { font-size: 24px; color: #1e293b; margin-bottom: 8px; }
    .error p { color: #64748b; }
    .error-path { margin-top: 12px; font-family: monospace; font-size: 13px; color: #94a3b8; }
    .error-detail { margin-top: 8px; font-family: monospace; font-size: 12px; color: #ef4444; word-break: break-all; max-width: 600px; margin-inline: auto; }
  `],
})
export class DocViewerComponent implements OnInit, OnDestroy {
  private router = inject(Router);
  private sanitizer = inject(DomSanitizer);
  private markdownService = inject(MarkdownService);
  private navService = inject(NavigationService);

  loading = signal(true);
  error = signal(false);
  errorDetail = signal('');
  rawHtml = signal('');
  safeHtml = signal<SafeHtml>('');
  currentPath = signal('');

  private routeSub?: Subscription;

  ngOnInit(): void {
    this.routeSub = this.router.events
      .pipe(filter((e) => e instanceof NavigationEnd))
      .subscribe(() => this.loadDocument());
    this.loadDocument();
  }

  ngOnDestroy(): void {
    this.routeSub?.unsubscribe();
  }

  private async loadDocument(): Promise<void> {
    const url = this.router.url.split('?')[0].split('#')[0];
    const docPath = url.startsWith('/') ? url.substring(1) : url;
    this.currentPath.set(docPath);
    this.navService.setActiveRoute(docPath);
    this.loading.set(true);
    this.error.set(false);
    this.errorDetail.set('');

    try {
      const filePath = `assets/docs/${docPath}.md`;
      const html = await this.markdownService.fetchAndParse(filePath);

      // Add unique IDs to headings for TOC
      const idCounts: Record<string, number> = {};
      const htmlWithIds = html.replace(
        /<h([1-4])([^>]*)>(.*?)<\/h[1-4]>/gi,
        (_match: string, level: string, attrs: string, content: string) => {
          const text = content.replace(/<[^>]*>/g, '').trim();
          let id = text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
          idCounts[id] = (idCounts[id] || 0) + 1;
          if (idCounts[id] > 1) {
            id = `${id}-${idCounts[id]}`;
          }
          return `<h${level} id="${id}"${attrs}>${content}</h${level}>`;
        }
      );

      this.rawHtml.set(htmlWithIds);
      this.safeHtml.set(this.sanitizer.bypassSecurityTrustHtml(htmlWithIds));
      this.loading.set(false);

      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err: any) {
      this.loading.set(false);
      this.error.set(true);
      this.errorDetail.set(err?.message || err?.toString() || 'Unknown error');
    }
  }

  handleClick(event: MouseEvent): void {
    const target = event.target as HTMLElement;
    const anchor = target.closest('a');
    if (!anchor) return;

    const href = anchor.getAttribute('href');
    if (!href) return;

    if (href.startsWith('http')) {
      event.preventDefault();
      window.open(href, '_blank');
      return;
    }

    if (href.startsWith('#')) {
      event.preventDefault();
      const el = document.getElementById(href.substring(1));
      if (el) el.scrollIntoView({ behavior: 'smooth' });
      return;
    }

    event.preventDefault();
    this.router.navigateByUrl(href);
  }
}
