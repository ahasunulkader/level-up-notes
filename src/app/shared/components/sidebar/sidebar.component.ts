import { Component, inject } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { NavigationService } from '../../../core/services/navigation.service';
import { NavigationItem } from '../../../core/models/navigation.model';

@Component({
  selector: 'app-sidebar',
  standalone: true,
  imports: [RouterLink, RouterLinkActive, NgTemplateOutlet],
  template: `
    <aside class="sidebar">
      <nav class="sidebar-nav">
        @for (item of navService.navigation(); track item.label) {
          <ng-container
            [ngTemplateOutlet]="navItem"
            [ngTemplateOutletContext]="{ $implicit: item, depth: 0 }"
          ></ng-container>
        }
      </nav>
    </aside>

    <ng-template #navItem let-item let-depth="depth">
      @if (item.children && item.children.length > 0) {
        <div class="nav-folder" [class.has-active-child]="navService.hasActiveChild(item)">
          <button
            class="nav-folder-btn"
            [style.padding-left.px]="16 + depth * 16"
            [class.expanded]="item.expanded"
            (click)="navService.toggleItem(item)"
          >
            <span class="folder-icon">{{ item.expanded ? '&#128194;' : '&#128193;' }}</span>
            <span class="folder-label">{{ item.label }}</span>
            <span class="chevron" [class.rotated]="item.expanded">&#9206;</span>
          </button>
          @if (item.expanded) {
            <div class="nav-children">
              @for (child of item.children; track child.label) {
                <ng-container
                  [ngTemplateOutlet]="navItem"
                  [ngTemplateOutletContext]="{ $implicit: child, depth: depth + 1 }"
                ></ng-container>
              }
            </div>
          }
        </div>
      } @else if (item.route) {
        <a
          class="nav-link"
          [routerLink]="'/' + item.route"
          routerLinkActive="active"
          [style.padding-left.px]="16 + depth * 16"
        >
          <span class="doc-icon">&#128196;</span>
          <span class="doc-label">{{ item.label }}</span>
        </a>
      }
    </ng-template>
  `,
  styles: [`
    .sidebar {
      width: 280px;
      min-width: 280px;
      background: #1e293b;
      border-right: 1px solid #334155;
      height: calc(100vh - 60px);
      overflow-y: auto;
      position: fixed;
      top: 60px;
      padding: 12px 0;
    }
    .sidebar::-webkit-scrollbar {
      width: 4px;
    }
    .sidebar::-webkit-scrollbar-track {
      background: transparent;
    }
    .sidebar::-webkit-scrollbar-thumb {
      background: #334155;
      border-radius: 4px;
    }
    .nav-folder-btn {
      display: flex;
      align-items: center;
      gap: 8px;
      width: 100%;
      padding: 8px 16px;
      background: none;
      border: none;
      color: #cbd5e1;
      font-size: 14px;
      cursor: pointer;
      text-align: left;
      transition: background 0.15s;
    }
    .nav-folder-btn:hover {
      background: rgba(255, 255, 255, 0.05);
    }
    .has-active-child > .nav-folder-btn {
      color: #60a5fa;
    }
    .folder-icon {
      font-size: 16px;
      flex-shrink: 0;
    }
    .folder-label {
      flex: 1;
      font-weight: 500;
    }
    .chevron {
      font-size: 10px;
      color: #64748b;
      transition: transform 0.2s;
      transform: rotate(90deg);
    }
    .chevron.rotated {
      transform: rotate(180deg);
    }
    .nav-children {
      overflow: hidden;
    }
    .nav-link {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 7px 16px;
      color: #94a3b8;
      text-decoration: none;
      font-size: 13px;
      transition: all 0.15s;
      border-left: 3px solid transparent;
    }
    .nav-link:hover {
      background: rgba(255, 255, 255, 0.03);
      color: #cbd5e1;
    }
    .nav-link.active {
      color: #60a5fa;
      background: rgba(59, 130, 246, 0.08);
      border-left-color: #3b82f6;
    }
    .doc-icon {
      font-size: 14px;
      flex-shrink: 0;
    }
    .doc-label {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    @media (max-width: 768px) {
      .sidebar {
        left: -280px;
        z-index: 50;
        transition: left 0.3s;
      }
      :host-context(.mobile-open) .sidebar,
      :host(.mobile-open) .sidebar {
        left: 0;
      }
    }
  `],
})
export class SidebarComponent {
  navService = inject(NavigationService);
}
