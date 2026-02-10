import { Injectable, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { NavigationItem } from '../models/navigation.model';

@Injectable({ providedIn: 'root' })
export class NavigationService {
  navigation = signal<NavigationItem[]>([]);
  activeRoute = signal<string>('');

  constructor(private http: HttpClient) {}

  loadNavigation(): void {
    this.http
      .get<NavigationItem[]>('assets/docs-navigation.json')
      .subscribe({
        next: (data) => this.navigation.set(data),
        error: () => this.navigation.set([]),
      });
  }

  setActiveRoute(route: string): void {
    this.activeRoute.set(route);
    this.expandParents(this.navigation(), route);
  }

  toggleItem(item: NavigationItem): void {
    item.expanded = !item.expanded;
  }

  isRouteActive(route?: string): boolean {
    if (!route) return false;
    return this.activeRoute() === route;
  }

  hasActiveChild(item: NavigationItem): boolean {
    if (!item.children) return false;
    return item.children.some(
      (child) =>
        this.isRouteActive(child.route) || this.hasActiveChild(child)
    );
  }

  private expandParents(items: NavigationItem[], route: string): boolean {
    for (const item of items) {
      if (item.route === route) return true;
      if (item.children && this.expandParents(item.children, route)) {
        item.expanded = true;
        return true;
      }
    }
    return false;
  }
}
