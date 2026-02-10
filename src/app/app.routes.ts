import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./features/docs/docs.component').then((m) => m.DocsComponent),
    children: [
      {
        path: '',
        loadComponent: () =>
          import(
            './features/docs/components/doc-home/doc-home.component'
          ).then((m) => m.DocHomeComponent),
      },
      {
        path: 'search',
        loadComponent: () =>
          import(
            './features/search/components/search-results/search-results.component'
          ).then((m) => m.SearchResultsComponent),
      },
      {
        path: '**',
        loadComponent: () =>
          import(
            './features/docs/components/doc-viewer/doc-viewer.component'
          ).then((m) => m.DocViewerComponent),
      },
    ],
  },
];
