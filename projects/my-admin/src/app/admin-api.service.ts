import { HttpClient, HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { Injectable, PLATFORM_ID, inject, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { firstValueFrom } from 'rxjs';

export interface AdminUser {
  _id: string;
  name: string;
  email: string;
  phone?: string;
  role: 'user' | 'admin';
  createdAt?: string;
}

export interface UserPayload {
  name: string;
  email: string;
  phone?: string;
  role: 'user' | 'admin';
  password?: string;
}

export interface Promotion {
  _id: string;
  id: string;
  code: string;
  name: string;
  description?: string;
  type: 'shipping' | 'percent' | 'fixed';
  discountValue: number;
  minOrder: number;
  maxDiscount?: number | null;
  startDate?: string;
  endDate?: string;
  quantity?: number | null;
  used: number;
  isActive: boolean;
}

export type PromotionPayload = Omit<Promotion, '_id' | 'id' | 'used'>;

export interface DashboardStats {
  products: number;
  orders: number;
  users: number;
  promotions: number;
  activePromotions: number;
  pendingOrders: number;
}

interface LoginResponse {
  token: string;
  user: { id: string; name: string; email: string; role: string };
}

@Injectable({ providedIn: 'root' })
export class AdminApiService {
  private readonly http = inject(HttpClient);
  private readonly platformId = inject(PLATFORM_ID);
  readonly token = signal<string | null>(null);

  restoreSession(): void {
    if (isPlatformBrowser(this.platformId)) {
      this.token.set(window.localStorage.getItem('urii-admin-token'));
    }
  }

  async login(email: string, password: string): Promise<LoginResponse> {
    const response = await firstValueFrom(
      this.http.post<LoginResponse>('/api/auth/login', { email, password })
    );
    if (response.user.role !== 'admin') {
      throw new Error('Tài khoản này không có quyền quản trị.');
    }
    this.token.set(response.token);
    if (isPlatformBrowser(this.platformId)) {
      window.localStorage.setItem('urii-admin-token', response.token);
    }
    return response;
  }

  logout(): void {
    this.token.set(null);
    if (isPlatformBrowser(this.platformId)) {
      window.localStorage.removeItem('urii-admin-token');
    }
  }

  async getDashboard(): Promise<DashboardStats> {
    return firstValueFrom(this.http.get<DashboardStats>('/api/dashboard', this.options()));
  }

  async getUsers(): Promise<AdminUser[]> {
    return firstValueFrom(this.http.get<AdminUser[]>('/api/users?page=1&limit=100', this.options()));
  }

  async createUser(payload: UserPayload): Promise<AdminUser> {
    return firstValueFrom(this.http.post<AdminUser>('/api/users', payload, this.options()));
  }

  async updateUser(id: string, payload: Partial<UserPayload>): Promise<AdminUser> {
    return firstValueFrom(this.http.patch<AdminUser>(`/api/users/${encodeURIComponent(id)}`, payload, this.options()));
  }

  async deleteUser(id: string): Promise<void> {
    await firstValueFrom(this.http.delete<void>(`/api/users/${encodeURIComponent(id)}`, this.options()));
  }

  async getPromotions(): Promise<Promotion[]> {
    return firstValueFrom(this.http.get<Promotion[]>('/api/vouchers/manage?page=1&limit=100', this.options()));
  }

  async createPromotion(payload: PromotionPayload): Promise<Promotion> {
    return firstValueFrom(this.http.post<Promotion>('/api/vouchers', payload, this.options()));
  }

  async updatePromotion(id: string, payload: Partial<PromotionPayload>): Promise<Promotion> {
    return firstValueFrom(this.http.patch<Promotion>(`/api/vouchers/${encodeURIComponent(id)}`, payload, this.options()));
  }

  async deletePromotion(id: string): Promise<void> {
    await firstValueFrom(this.http.delete<void>(`/api/vouchers/${encodeURIComponent(id)}`, this.options()));
  }

  private options(): { headers: HttpHeaders } {
    const token = this.token();
    return {
      headers: token ? new HttpHeaders({ Authorization: `Bearer ${token}` }) : new HttpHeaders()
    };
  }
}

export function apiErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof HttpErrorResponse) {
    const message = error.error?.message;
    return typeof message === 'string' ? message : fallback;
  }
  return error instanceof Error ? error.message : fallback;
}
