import { Routes } from '@angular/router';
import { HomepageComponent } from './features/pages/homepage/homepage';
import { CustomOrderRequestComponent } from './features/pages/custom-order-request/custom-order-request';
import { Product } from './product/product';

export const routes: Routes = [
  { path: '', component: HomepageComponent },
  { path: 'products', component: Product },
  { path: 'custom-order', component: CustomOrderRequestComponent }
];