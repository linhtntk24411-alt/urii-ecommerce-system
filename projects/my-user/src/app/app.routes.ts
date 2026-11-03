import { Routes } from '@angular/router';
import { HomepageComponent } from './features/homepage/homepage';
import { BlogListComponent } from './features/blogs/blog-list/blog-list';
import { BlogDetailComponent } from './features/blogs/blog-detail/blog-detail';
import { CustomOrderComponent } from './features/custom-order/custom-order';
import { SampleMapsComponent } from './features/sample-maps/sample-maps';
import { LoginUser } from './features/login-user/login-user';
import { SampleMapsDetailComponent } from './features/sample-maps-detail/sample-maps-detail';
import { BlogCreateComponent } from './features/blogs/blog-create/blog-create';
import { SupportComponent } from './features/support/support';
import { About } from './features/about/about';
import { PageNotFoundComponent } from './features/page-not-found/page-not-found';
import { Product } from './features/product/product';
import { ProductDetail } from './features/product-detail/product-detail';

export const routes: Routes = [
  { path: '', component: HomepageComponent },
  { path: 'products', component: Product },
  { path: 'favorites', component: Product, data: { favoritesOnly: true } },
  { path: 'product-detail/:slug', component: ProductDetail },
  { path: 'custom-order', component: CustomOrderComponent },
  { path: 'blog-list', component: BlogListComponent },
  { path: 'blog-detail', component: BlogDetailComponent },
  { path: 'blog-create', component: BlogCreateComponent },
  { path: 'sample-maps', component: SampleMapsComponent },
  { path: 'login', component: LoginUser },
  { path: 'sample-maps-detail', component: SampleMapsDetailComponent },
  { path: 'support', component: SupportComponent },
  { path: 'about', component: About },
  { path: '**', component: PageNotFoundComponent },
];