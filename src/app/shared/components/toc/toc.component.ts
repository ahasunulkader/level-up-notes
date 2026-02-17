import {
  Component,
  input,
  signal,
  OnChanges,
  OnDestroy,
  AfterViewInit,
} from '@angular/core';

interface TocItem {
  id: string;
  text: string;
  level: number;
}

@Component({
  selector: 'app-toc',
  standalone: true,
  template: `
    @if (items().length > 0) {
      <div class="toc">
        <h4 class="toc-title">On this page</h4>
        <nav>
          @for (item of items(); track item.id) {
            <a
              class="toc-link"
              [class.active]="activeId() === item.id"
              [style.padding-left.px]="8 + (item.level - 1) * 12"
              (click)="scrollTo(item.id)"
            >
              {{ item.text }}
            </a>
          }
        </nav>
      </div>
    }
  `,
  styles: [`
    :host {
      position: sticky;
      top: 76px;
      align-self: flex-start;
      max-height: calc(100vh - 90px);
    }
    .toc {
      width: 240px;
      min-width: 240px;
      padding: 16px 0;
      overflow-y: auto;
      max-height: calc(100vh - 90px);
    }
    .toc-title {
      font-size: 13px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 1.2px;
      color: #64748b;
      padding: 0 10px;
      margin-bottom: 14px;
    }
    .toc-link {
      display: block;
      padding: 5px 10px;
      font-size: 14px;
      line-height: 1.5;
      color: #64748b;
      text-decoration: none;
      border-left: 2px solid #e2e8f0;
      cursor: pointer;
      transition: all 0.15s;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .toc-link:hover {
      color: #334155;
      background: #f8fafc;
    }
    .toc-link.active {
      color: #2563eb;
      border-left-color: #2563eb;
      font-weight: 500;
    }
    @media (max-width: 1100px) {
      :host { display: none; }
      .toc { display: none; }
    }
  `],
})
export class TocComponent implements OnChanges, OnDestroy, AfterViewInit {
  htmlContent = input<string>('');
  items = signal<TocItem[]>([]);
  activeId = signal<string>('');

  private scrollListener: (() => void) | null = null;

  ngOnChanges(): void {
    this.extractHeadings();
  }

  ngAfterViewInit(): void {
    this.setupScrollSpy();
  }

  ngOnDestroy(): void {
    if (this.scrollListener) {
      window.removeEventListener('scroll', this.scrollListener);
    }
  }

  private extractHeadings(): void {
    const content = this.htmlContent();
    if (!content) {
      this.items.set([]);
      return;
    }

    const headingRegex = /<h([1-4])\s*(?:id="([^"]*)")?[^>]*>(.*?)<\/h[1-4]>/gi;
    const headings: TocItem[] = [];
    let match: RegExpExecArray | null;

    while ((match = headingRegex.exec(content)) !== null) {
      const level = parseInt(match[1]);
      const text = match[3].replace(/<[^>]*>/g, '').trim();
      const id = match[2] || text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      headings.push({ id, text, level });
    }

    this.items.set(headings);
  }

  scrollTo(id: string): void {
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      this.activeId.set(id);
    }
  }

  private setupScrollSpy(): void {
    this.scrollListener = () => {
      const headings = this.items();
      if (!headings.length) return;

      let currentId = headings[0].id;
      for (const heading of headings) {
        const el = document.getElementById(heading.id);
        if (el && el.getBoundingClientRect().top <= 100) {
          currentId = heading.id;
        }
      }
      this.activeId.set(currentId);
    };

    window.addEventListener('scroll', this.scrollListener, { passive: true });
  }
}
