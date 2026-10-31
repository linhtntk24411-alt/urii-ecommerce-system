import { Routes } from '@angular/router';
import { HomepageComponent } from './features/pages/homepage/homepage';
import { CustomOrderRequestComponent } from './features/pages/custom-order-request/custom-order-request';
import { LoginUser } from './features/login-user/login-user';

export const routes: Routes = [
  { path: '', component: HomepageComponent },
  { path: 'login', component: LoginUser },
  { path: 'custom-order', component: CustomOrderRequestComponent }
];