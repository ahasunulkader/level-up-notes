import { Component, inject, OnInit, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { NavigationService } from '../../../../core/services/navigation.service';
import { NavigationItem } from '../../../../core/models/navigation.model';

interface QuickLink {
  label: string;
  route: string;
  icon: string;
  category: string;
}

@Component({
  selector: 'app-doc-home',
  standalone: true,
  imports: [RouterLink],
  template: `
    <div class="home">
      <div class="hero">
        <h1>&#128218; Level Up Notes</h1>
        <p>My personal learning journal. Everything I learn, organized and searchable.</p>
      </div>

      @if (categories().length > 0) {
        <h2 class="section-heading">&#128204; Quick Links</h2>
        <div class="cards-grid">
          @for (cat of categories(); track cat.label) {
            <div class="category-card">
              <h3>{{ cat.label }}</h3>
              <div class="link-list">
                @for (link of cat.links; track link.route) {
                  <a [routerLink]="'/' + link.route" class="quick-link">
                    <span class="link-dot"></span>
                    {{ link.label }}
                  </a>
                }
              </div>
            </div>
          }
        </div>
      } @else {
        <div class="empty-state">
          <p>&#128221; No notes yet. Add your first markdown file to <code>src/assets/docs/</code> and run <code>npm run generate:nav</code>!</p>
        </div>
      }

      <div class="getting-started">
        <h2>&#128640; How to Add Notes</h2>
        <ol>
          <li>Create a <code>.md</code> file in <code>src/assets/docs/YourFolder/</code></li>
          <li>Write your notes in plain Markdown</li>
          <li>Run <code>npm run build</code> (auto-generates navigation)</li>
          <li>Push to GitHub — site updates automatically!</li>
        </ol>
      </div>
    </div>
  `,
  styles: [`
    .home { max-width: 900px; }
    .hero {
      margin-bottom: 36px;
    }
    .hero h1 {
      font-size: 32px;
      font-weight: 700;
      color: #1e293b;
      margin-bottom: 8px;
    }
    .hero p {
      color: #64748b;
      font-size: 16px;
    }
    .section-heading {
      font-size: 20px;
      color: #1e293b;
      margin-bottom: 16px;
    }
    .cards-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
      gap: 16px;
      margin-bottom: 36px;
    }
    .category-card {
      background: #ffffff;
      border: 1px solid #e2e8f0;
      border-radius: 10px;
      padding: 20px;
      transition: border-color 0.2s, box-shadow 0.2s;
    }
    .category-card:hover {
      border-color: #cbd5e1;
      box-shadow: 0 2px 8px rgba(0,0,0,0.06);
    }
    .category-card h3 {
      font-size: 15px;
      color: #1e293b;
      margin-bottom: 12px;
      font-weight: 600;
    }
    .link-list {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .quick-link {
      display: flex;
      align-items: center;
      gap: 8px;
      color: #64748b;
      text-decoration: none;
      font-size: 13px;
      padding: 4px 0;
      transition: color 0.15s;
    }
    .quick-link:hover {
      color: #2563eb;
    }
    .link-dot {
      width: 5px;
      height: 5px;
      border-radius: 50%;
      background: #cbd5e1;
      flex-shrink: 0;
    }
    .quick-link:hover .link-dot {
      background: #2563eb;
    }
    .empty-state {
      background: #f8fafc;
      border: 1px dashed #e2e8f0;
      border-radius: 10px;
      padding: 40px;
      text-align: center;
      margin-bottom: 36px;
    }
    .empty-state p {
      color: #64748b;
      font-size: 15px;
    }
    .getting-started {
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 10px;
      padding: 24px;
    }
    .getting-started h2 {
      font-size: 18px;
      color: #1e293b;
      margin-bottom: 16px;
    }
    .getting-started ol {
      padding-left: 20px;
    }
    .getting-started li {
      color: #475569;
      font-size: 14px;
      margin-bottom: 8px;
      line-height: 1.6;
    }
    code {
      background: #f1f5f9;
      color: #2563eb;
      padding: 2px 6px;
      border-radius: 4px;
      font-size: 13px;
    }
  `],
})
export class DocHomeComponent implements OnInit {
  private navService = inject(NavigationService);
  categories = signal<{ label: string; links: QuickLink[] }[]>([]);

  ngOnInit(): void {
    // Wait for navigation to load, then build quick links
    setTimeout(() => this.buildQuickLinks(), 500);
  }

  private buildQuickLinks(): void {
    const nav = this.navService.navigation();
    const cats: { label: string; links: QuickLink[] }[] = [];

    for (const item of nav) {
      if (item.children && item.children.length > 0) {
        const links = this.extractLinks(item.children);
        if (links.length > 0) {
          cats.push({ label: item.label, links });
        }
      } else if (item.route) {
        // Top-level docs go into "General" category
        const existing = cats.find((c) => c.label === 'General');
        if (existing) {
          existing.links.push({
            label: item.label,
            route: item.route,
            icon: '',
            category: 'General',
          });
        } else {
          cats.push({
            label: 'General',
            links: [
              { label: item.label, route: item.route, icon: '', category: 'General' },
            ],
          });
        }
      }
    }
    this.categories.set(cats);
  }

  private extractLinks(items: NavigationItem[]): QuickLink[] {
    const links: QuickLink[] = [];
    for (const item of items) {
      if (item.route) {
        links.push({
          label: item.label,
          route: item.route,
          icon: '',
          category: '',
        });
      }
      if (item.children) {
        links.push(...this.extractLinks(item.children));
      }
    }
    return links;
  }
}
