import { RenderMode, ServerRoute } from '@angular/ssr';

export const serverRoutes: ServerRoute[] = [
  {
    path: 'checkout',
    renderMode: RenderMode.Server,
  },
  {
    path: 'cart',
    renderMode: RenderMode.Server,
  },
  {
    path: 'product-detail/:slug',
    renderMode: RenderMode.Server,
  },
  {
    path: 'blog-detail/:slug',
    renderMode: RenderMode.Server,
  },
  {
    path: 'sample-maps-detail/:slug',
    renderMode: RenderMode.Server,
  },
  {
    path: 'support/support-center',
    renderMode: RenderMode.Server,
  },
  {
    path: 'support/faq',
    renderMode: RenderMode.Server,
  },
  {
    path: 'support/privacy-policy',
    renderMode: RenderMode.Server,
  },
  {
    path: 'support/terms-of-service',
    renderMode: RenderMode.Server,
  },
  {
    path: '**',
    renderMode: RenderMode.Prerender,
  },
];
