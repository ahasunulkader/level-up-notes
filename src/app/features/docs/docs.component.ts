import { Component, signal, inject, OnInit } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { HeaderComponent } from '../../shared/components/header/header.component';
import { SidebarComponent } from '../../shared/components/sidebar/sidebar.component';
import { NavigationService } from '../../core/services/navigation.service';

@Component({
  selector: 'app-docs',
  standalone: true,
  imports: [RouterOutlet, HeaderComponent, SidebarComponent],
  template: `
    <div class="docs-layout">
      <app-header (menuToggle)="toggleMobileMenu()" />
      <div class="docs-container">
        <app-sidebar [class.mobile-open]="isMobileMenuOpen()" />
        @if (isMobileMenuOpen()) {
          <div class="mobile-overlay" (click)="closeMobileMenu()"></div>
        }
        <main class="docs-content">
          <router-outlet />
        </main>
      </div>
    </div>
  `,
  styles: [`
    .docs-layout {
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      background: #ffffff;
      padding-top: 60px;
    }
    .docs-container {
      display: flex;
      flex: 1;
    }
    .docs-content {
      flex: 1;
      padding: 32px 48px;
      margin-left: var(--sidebar-width, 280px);
      min-width: 0;
      overflow-x: clip;
      background: #ffffff;
    }
    .mobile-overlay {
      display: none;
    }
    @media (max-width: 768px) {
      .docs-content {
        padding: 20px 16px;
        margin-left: 0;
      }
      .mobile-overlay {
        display: block;
        position: fixed;
        inset: 0;
        background: rgba(0, 0, 0, 0.5);
        z-index: 40;
      }
    }
  `],
})
export class DocsComponent implements OnInit {
  private navService = inject(NavigationService);
  isMobileMenuOpen = signal(false);

  ngOnInit(): void {
    this.navService.loadNavigation();
  }

  toggleMobileMenu(): void {
    this.isMobileMenuOpen.update((v) => !v);
  }

  closeMobileMenu(): void {
    this.isMobileMenuOpen.set(false);
  }
}
