import { Routes } from '@angular/router';
import { AdminLayoutComponent } from './layout/admin-layout.component';
import { ProductsAdmin } from './features/products-admin/products-admin';
import { OrdersAdmin } from './features/orders-admin/orders-admin';
import { MapAdmin } from './features/map-admin/map-admin';
import { SupportAdmin } from './features/support-admin/support-admin';

export const routes: Routes = [
  {
    path: '',
    component: AdminLayoutComponent,
    children: [
      { path: 'products', component: ProductsAdmin },
      { path: 'orders', component: OrdersAdmin },
      { path: 'library', component: MapAdmin },
      { path: 'chatbot', component: SupportAdmin },
      { path: '', redirectTo: 'products', pathMatch: 'full' }
    ]
  }
];