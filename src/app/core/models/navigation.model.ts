export interface NavigationItem {
  label: string;
  route?: string;
  icon?: string;
  children?: NavigationItem[];
  expanded?: boolean;
}

export interface QuickLink {
  label: string;
  route: string;
  icon: string;
  category: string;
}
