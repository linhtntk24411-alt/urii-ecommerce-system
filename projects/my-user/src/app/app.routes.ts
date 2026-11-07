import { Routes } from '@angular/router';
import { HomepageComponent } from './features/homepage/homepage';
import { BlogListComponent } from './features/blogs/blog-list/blog-list';
import { BlogDetailComponent } from './features/blogs/blog-detail/blog-detail';
import { CustomOrderComponent } from './features/custom-order/custom-order';
import { SampleMapsComponent } from './features/sample-maps/sample-maps';
import { LoginUser } from './features/login-user/login-user';
import { SampleMapsDetailComponent } from './features/sample-maps-detail/sample-maps-detail';
import { BlogCreateComponent } from './features/blogs/blog-create/blog-create';
import { MyBlogsComponent } from './features/account/my-blogs/my-blogs';
import { Information } from './features/account/information/information';
import { MyOrders } from './features/account/my-orders/my-orders';
import { CustomOrders } from './features/account/custom-orders/custom-orders';
import { SavedMaps } from './features/account/saved-maps/saved-maps';
import { MyReviews } from './features/account/my-reviews/my-reviews';
import { SidebarAccount } from './layout/sidebar-account/sidebar-account';
import { SupportComponent } from './features/support/support';
import { About } from './features/about/about';
import { PageNotFoundComponent } from './features/page-not-found/page-not-found';
import { Product } from './features/product/product';
import { ProductDetail } from './features/product-detail/product-detail';
import { Cart } from './features/cart/cart';
import { CheckOut } from './features/check-out/check-out';

export const routes: Routes = [
  { path: '', component: HomepageComponent },
  { path: 'products', component: Product },
  { path: 'product-detail/:slug', component: ProductDetail },
  { path: 'cart', component: Cart },
  { path: 'checkout', component: CheckOut },
  { path: 'blog-list', component: BlogListComponent },
  { path: 'blog-detail', component: BlogDetailComponent },
  { path: 'blog-detail/:slug', component: BlogDetailComponent },
  { path: 'blog-create', component: BlogCreateComponent },
  { path: 'sample-maps', component: SampleMapsComponent },
  { path: 'sample-maps-detail', component: SampleMapsDetailComponent },
  { path: 'sample-maps-detail/:slug', component: SampleMapsDetailComponent },
  { path: 'login', component: LoginUser },
  { path: 'register', component: LoginUser },
  { path: 'support', component: SupportComponent },
  { path: 'support/support-center', component: SupportComponent },
  { path: 'support/faq', component: SupportComponent },
  { path: 'support/privacy-policy', component: SupportComponent },
  { path: 'support/terms-of-service', component: SupportComponent },
  { path: 'about', component: About },
  { path: 'account/orders', redirectTo: 'orders', pathMatch: 'full' },
  { path: 'account/profile', redirectTo: 'profile', pathMatch: 'full' },
  {
    path: '',
    component: SidebarAccount,
    children: [
      { path: 'profile', component: Information },
      { path: 'my-blogs', component: MyBlogsComponent },
      { path: 'orders', component: MyOrders },
      { path: 'orders/:slug', component: MyOrders },
      { path: 'favorites', component: Product, data: { favoritesOnly: true } },
      { path: 'custom-order-list', component: CustomOrders },
      { path: 'custom-order-list/:slug', component: CustomOrders },
      { path: 'custom-order', component: CustomOrderComponent },
      { path: 'saved-maps', component: SavedMaps },
      { path: 'myreview', component: MyReviews },
    ],
  },
  { path: '**', component: PageNotFoundComponent },
];