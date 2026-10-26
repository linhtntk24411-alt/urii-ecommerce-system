import { Routes } from '@angular/router';
import { ProductDetail } from './product-detail/product-detail';
import { ProductList } from './product-list/product-list';

export const routes: Routes = [
  { path: '', component: ProductList },
  { path: 'product-detail', component: ProductDetail },
];
