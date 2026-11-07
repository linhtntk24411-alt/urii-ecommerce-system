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

export interface ChatMessage {
  text: string;
  sender: 'user' | 'bot' | 'admin';
  timestamp: number;
  isSystemLog?: boolean;
}

export interface ChatSession {
  _id?: string;
  sessionId: string;
  userName: string;
  userEmail?: string;
  avatar?: string;
  status: 'ai' | 'waiting' | 'active';
  unreadCount: number;
  lastMessageTime: number;
  messages: ChatMessage[];
}

export interface LoginResponse {
  token: string;
  user: { id: string; name: string; email: string; role: string };
}

@Injectable({ providedIn: 'root' })
export class AdminApiService {
  private readonly http = inject(HttpClient);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly baseUrl = 'http://localhost:3002/api';
  readonly token = signal<string | null>(null);

  restoreSession(): void {
    if (isPlatformBrowser(this.platformId)) {
      const saved = window.localStorage.getItem('adminToken')
        || window.localStorage.getItem('urii-admin-token')
        || window.localStorage.getItem('token');
      this.token.set(saved);
    }
  }

  async login(email: string, password: string): Promise<LoginResponse> {
    const response = await firstValueFrom(
      this.http.post<LoginResponse>(`${this.baseUrl}/auth/login`, { email, password })
    );
    if (response.user.role !== 'admin') {
      throw new Error('Tài khoản này không có quyền quản trị.');
    }
    this.setSession(response.token, response.user);
    return response;
  }

  async loginGoogle(googleToken: string): Promise<LoginResponse> {
    const response = await firstValueFrom(
      this.http.post<LoginResponse>(`${this.baseUrl}/auth/google`, { token: googleToken })
    );
    if (response.user.role !== 'admin') {
      throw new Error('Tài khoản này không có quyền quản trị.');
    }
    this.setSession(response.token, response.user);
    return response;
  }

  setSession(token: string, user?: any): void {
    this.token.set(token);
    if (isPlatformBrowser(this.platformId)) {
      window.localStorage.setItem('adminToken', token);
      window.localStorage.setItem('urii-admin-token', token);
      window.localStorage.setItem('token', token);
      if (user) {
        window.localStorage.setItem('adminUser', JSON.stringify(user));
      }
    }
  }

  logout(): void {
    this.token.set(null);
    if (isPlatformBrowser(this.platformId)) {
      window.localStorage.removeItem('adminToken');
      window.localStorage.removeItem('urii-admin-token');
      window.localStorage.removeItem('token');
      window.localStorage.removeItem('adminUser');
    }
  }

  async getDashboard(): Promise<DashboardStats> {
    return firstValueFrom(this.http.get<DashboardStats>(`${this.baseUrl}/dashboard`, this.options()));
  }

  async getUsers(): Promise<AdminUser[]> {
    return firstValueFrom(this.http.get<AdminUser[]>(`${this.baseUrl}/users?page=1&limit=100`, this.options()));
  }

  async createUser(payload: UserPayload): Promise<AdminUser> {
    return firstValueFrom(this.http.post<AdminUser>(`${this.baseUrl}/users`, payload, this.options()));
  }

  async updateUser(id: string, payload: Partial<UserPayload>): Promise<AdminUser> {
    return firstValueFrom(this.http.patch<AdminUser>(`${this.baseUrl}/users/${encodeURIComponent(id)}`, payload, this.options()));
  }

  async deleteUser(id: string): Promise<void> {
    await firstValueFrom(this.http.delete<void>(`${this.baseUrl}/users/${encodeURIComponent(id)}`, this.options()));
  }

  async getPromotions(): Promise<Promotion[]> {
    return firstValueFrom(this.http.get<Promotion[]>(`${this.baseUrl}/vouchers/manage?page=1&limit=100`, this.options()));
  }

  async createPromotion(payload: PromotionPayload): Promise<Promotion> {
    return firstValueFrom(this.http.post<Promotion>(`${this.baseUrl}/vouchers`, payload, this.options()));
  }

  async updatePromotion(id: string, payload: Partial<PromotionPayload>): Promise<Promotion> {
    return firstValueFrom(this.http.patch<Promotion>(`${this.baseUrl}/vouchers/${encodeURIComponent(id)}`, payload, this.options()));
  }

  async deletePromotion(id: string): Promise<void> {
    await firstValueFrom(this.http.delete<void>(`${this.baseUrl}/vouchers/${encodeURIComponent(id)}`, this.options()));
  }

  async getChatSessions(status?: string, query?: string): Promise<{ sessions: ChatSession[]; sessionMap: Record<string, ChatSession> }> {
    let url = `${this.baseUrl}/chat/sessions`;
    const params = new URLSearchParams();
    if (status && status !== 'all') params.set('status', status);
    if (query) params.set('q', query);
    const queryString = params.toString();
    if (queryString) url += `?${queryString}`;
    return firstValueFrom(this.http.get<{ sessions: ChatSession[]; sessionMap: Record<string, ChatSession> }>(url, this.options()));
  }

  async sendAdminChatMessage(sessionId: string, text: string): Promise<ChatSession> {
    return firstValueFrom(this.http.post<ChatSession>(`${this.baseUrl}/chat/sessions/${encodeURIComponent(sessionId)}/messages`, { text, sender: 'admin' }, this.options()));
  }

  async updateChatSessionStatus(sessionId: string, status: 'ai' | 'waiting' | 'active', systemLog?: string): Promise<ChatSession> {
    return firstValueFrom(this.http.put<ChatSession>(`${this.baseUrl}/chat/sessions/${encodeURIComponent(sessionId)}/status`, { status, systemLog }, this.options()));
  }

  private options(): { headers: HttpHeaders } {
    let token = this.token();
    if (!token && isPlatformBrowser(this.platformId)) {
      token = window.localStorage.getItem('adminToken')
        || window.localStorage.getItem('urii-admin-token')
        || window.localStorage.getItem('token');
    }
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
