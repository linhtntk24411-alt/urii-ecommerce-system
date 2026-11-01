import { Routes } from '@angular/router';
import { HomepageComponent } from './features/pages/homepage/homepage';
import { BlogListComponent } from './features/blogs/blog-list/blog-list';
import { CustomOrderComponent } from './features/custom-order/custom-order';
import { SampleMapsComponent } from './features/sample-maps/sample-maps';
import { LoginUser } from './features/login-user/login-user'; 

export const routes: Routes = [
  { path: '', component: HomepageComponent },
  { path: 'custom-order', component: CustomOrderComponent },
  { path: 'blog-list', component: BlogListComponent },
  { path: 'sample-maps', component: SampleMapsComponent },
  { path: 'login', component: LoginUser } 
];