import { Component, inject, signal, HostListener, OnInit, DOCUMENT } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { NavigationService } from '../../../core/services/navigation.service';
import { NavigationItem } from '../../../core/models/navigation.model';

@Component({
  selector: 'app-sidebar',
  standalone: true,
  imports: [RouterLink, RouterLinkActive, NgTemplateOutlet],
  template: `
    <aside class="sidebar" [style.width.px]="sidebarWidth()">
      <nav class="sidebar-nav">
        @for (item of navService.navigation(); track item.label) {
          <ng-container
            [ngTemplateOutlet]="navItem"
            [ngTemplateOutletContext]="{ $implicit: item, depth: 0 }"
          ></ng-container>
        }
      </nav>
      <div class="resize-handle" (mousedown)="onResizeStart($event)"></div>
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
      min-width: 180px;
      max-width: 600px;
      background: #1e293b;
      border-right: 1px solid #334155;
      height: calc(100vh - 60px);
      overflow-y: auto;
      overflow-x: hidden;
      position: fixed;
      top: 60px;
      padding: 12px 0;
      box-sizing: border-box;
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
    .resize-handle {
      position: absolute;
      top: 0;
      right: 0;
      width: 5px;
      height: 100%;
      cursor: col-resize;
      background: transparent;
      z-index: 10;
      transition: background 0.15s;
    }
    .resize-handle:hover {
      background: rgba(96, 165, 250, 0.35);
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
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .chevron {
      font-size: 10px;
      color: #64748b;
      transition: transform 0.2s;
      transform: rotate(90deg);
      flex-shrink: 0;
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
      .resize-handle {
        display: none;
      }
    }
  `],
})
export class SidebarComponent implements OnInit {
  navService = inject(NavigationService);
  private doc = inject(DOCUMENT);

  sidebarWidth = signal(280);
  private isResizing = false;
  private startX = 0;
  private startWidth = 280;

  ngOnInit(): void {
    this.doc.documentElement.style.setProperty('--sidebar-width', '280px');
  }

  onResizeStart(event: MouseEvent): void {
    this.isResizing = true;
    this.startX = event.clientX;
    this.startWidth = this.sidebarWidth();
    this.doc.body.style.userSelect = 'none';
    this.doc.body.style.cursor = 'col-resize';
    event.preventDefault();
  }

  @HostListener('document:mousemove', ['$event'])
  onMouseMove(event: MouseEvent): void {
    if (!this.isResizing) return;
    const delta = event.clientX - this.startX;
    const newWidth = Math.max(180, Math.min(600, this.startWidth + delta));
    this.sidebarWidth.set(newWidth);
    this.doc.documentElement.style.setProperty('--sidebar-width', newWidth + 'px');
  }

  @HostListener('document:mouseup')
  onMouseUp(): void {
    if (!this.isResizing) return;
    this.isResizing = false;
    this.doc.body.style.userSelect = '';
    this.doc.body.style.cursor = '';
  }
}
