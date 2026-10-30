import { Routes } from '@angular/router';
import { DashboardComponent } from './dashboard.component';
import { PromotionsComponent } from './promotions.component';
import { UsersComponent } from './users.component';

export const routes: Routes = [
  { path: '', component: DashboardComponent },
  { path: 'promotions', component: PromotionsComponent },
  { path: 'users', component: UsersComponent },
  { path: '**', redirectTo: '' }
];
