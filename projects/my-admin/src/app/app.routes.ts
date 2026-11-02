import { isPlatformBrowser } from '@angular/common';
import { inject, PLATFORM_ID } from '@angular/core';
import { CanActivateChildFn, Router, Routes } from '@angular/router';
import { AdminLayoutComponent } from './layout/admin-layout.component';
import { ProductsAdmin } from './features/products-admin/products-admin';
import { OrdersAdmin } from './features/orders-admin/orders-admin';
import { MapAdmin } from './features/map-admin/map-admin';
import { SupportAdmin } from './features/support-admin/support-admin';
import { LoginAdmin } from './features/login-admin/login-admin';
import { DashboardComponent } from './features/dashboard/dashboard.component';
import { PromotionsComponent } from './features/promotions/promotions.component';
import { UsersComponent } from './features/users/users.component';

const requireAdminLogin: CanActivateChildFn = () => {
  if (!isPlatformBrowser(inject(PLATFORM_ID))) {
    return true;
  }

  const token = localStorage.getItem('adminToken') || localStorage.getItem('token');
  return token ? true : inject(Router).createUrlTree(['/']);
};

export const routes: Routes = [
  { path: '', component: LoginAdmin, pathMatch: 'full' },
  {
    path: '',
    component: AdminLayoutComponent,
    canActivateChild: [requireAdminLogin],
    children: [
      { path: 'dashboard', component: DashboardComponent },
      { path: 'products', component: ProductsAdmin },
      { path: 'orders', component: OrdersAdmin },
      { path: 'coupons', component: PromotionsComponent },
      { path: 'promotions', redirectTo: 'coupons', pathMatch: 'full' },
      { path: 'users', component: UsersComponent },
      { path: 'library', component: MapAdmin },
      { path: 'chatbot', component: SupportAdmin },
      { path: '', redirectTo: 'products', pathMatch: 'full' }
    ]
  }
];
