import { Routes } from '@angular/router';
import { AdminLayoutComponent } from './layout/admin-layout.component';
import { ProductsAdminComponent } from './features/products-admin/products-admin';

export const routes: Routes = [
  {
    path: '',
    component: AdminLayoutComponent,
    children: [
      { path: 'products', component: ProductsAdminComponent },
      { path: '', redirectTo: 'products', pathMatch: 'full' }
    ]
  }
];