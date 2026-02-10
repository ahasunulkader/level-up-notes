import { Component, output } from '@angular/core';
import { Router } from '@angular/router';

@Component({
  selector: 'app-header',
  standalone: true,
  template: `
    <header class="header">
      <div class="header-left">
        <button class="menu-toggle" (click)="menuToggle.emit()">
          <span class="hamburger"></span>
        </button>
        <a class="logo" routerLink="/">
          <span class="logo-icon">&#128218;</span>
          <span class="logo-text">Level Up Notes</span>
        </a>
      </div>
      <div class="header-right">
        <div class="search-box">
          <span class="search-icon">&#128269;</span>
          <input
            type="text"
            placeholder="Search notes..."
            #searchInput
            (keydown.enter)="onSearch(searchInput.value)"
          />
        </div>
      </div>
    </header>
  `,
  styles: [`
    .header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 24px;
      height: 60px;
      background: #1e293b;
      border-bottom: 1px solid #334155;
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      z-index: 100;
    }
    .header-left {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .menu-toggle {
      display: none;
      background: none;
      border: none;
      cursor: pointer;
      padding: 8px;
    }
    .hamburger {
      display: block;
      width: 20px;
      height: 2px;
      background: #94a3b8;
      position: relative;
    }
    .hamburger::before, .hamburger::after {
      content: '';
      position: absolute;
      width: 20px;
      height: 2px;
      background: #94a3b8;
      left: 0;
    }
    .hamburger::before { top: -6px; }
    .hamburger::after { top: 6px; }
    .logo {
      display: flex;
      align-items: center;
      gap: 10px;
      text-decoration: none;
      color: #f1f5f9;
      font-size: 18px;
      font-weight: 700;
    }
    .logo-icon {
      font-size: 24px;
    }
    .logo-text {
      background: linear-gradient(135deg, #60a5fa, #a78bfa);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
    }
    .search-box {
      display: flex;
      align-items: center;
      background: #0f172a;
      border: 1px solid #334155;
      border-radius: 8px;
      padding: 6px 12px;
      gap: 8px;
      transition: border-color 0.2s;
    }
    .search-box:focus-within {
      border-color: #3b82f6;
    }
    .search-icon {
      font-size: 14px;
      color: #64748b;
    }
    .search-box input {
      background: none;
      border: none;
      color: #e2e8f0;
      font-size: 14px;
      outline: none;
      width: 220px;
    }
    .search-box input::placeholder {
      color: #475569;
    }
    @media (max-width: 768px) {
      .menu-toggle { display: block; }
      .search-box input { width: 140px; }
    }
  `],
})
export class HeaderComponent {
  menuToggle = output<void>();

  constructor(private router: Router) {}

  onSearch(query: string): void {
    if (query.trim()) {
      this.router.navigate(['/search'], { queryParams: { q: query.trim() } });
    }
  }
}
