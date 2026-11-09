import { HttpClient, HttpHeaders } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';

export interface VoucherDetail {
  _id?: string;
  id?: string;
  code: string;
  name: string;
  description?: string;
  type: 'shipping' | 'percent' | 'fixed';
  discountValue: number;
  minOrder?: number;
  maxDiscount?: number;
  startDate?: string;
  endDate?: string;
  quantity?: number;
  used?: number;
  isActive?: boolean;
}

export interface UserVoucherItem {
  _id?: string;
  userId?: string;
  voucherId: string;
  code: string;
  source?: 'promotion' | 'birthday' | string;
  claimedAt?: string;
  isUsed?: boolean;
  usedAt?: string | null;
  reservedByPaymentId?: string | null;
  voucher?: VoucherDetail | null;
}

export interface ClaimVoucherResponse {
  message: string;
  userVoucher?: UserVoucherItem;
  claimedCount?: number;
}

export interface VoucherCheckResult {
  valid: boolean;
  code?: string;
  reason?: 'NOT_FOUND' | 'INACTIVE' | 'NOT_STARTED' | 'EXPIRED' | 'OUT_OF_STOCK' | string;
  message: string;
  voucher?: VoucherDetail | null;
}

@Injectable({
  providedIn: 'root',
})
export class VoucherService {
  private readonly http = inject(HttpClient);

  checkVoucher(code: string): Observable<VoucherCheckResult> {
    const trimmed = encodeURIComponent(code.trim().toUpperCase());
    return this.http.get<VoucherCheckResult>(`/api/vouchers/check/${trimmed}`);
  }

  getMyVouchers(token: string): Observable<UserVoucherItem[]> {
    const headers = new HttpHeaders({ Authorization: `Bearer ${token}` });
    return this.http.get<UserVoucherItem[]>('/api/user-vouchers/mine', { headers });
  }

  getUnclaimedVouchers(token?: string): Observable<{
    isLoggedIn: boolean;
    totalActive: number;
    claimedCount: number;
    vouchers: VoucherDetail[];
  }> {
    const headers = token ? new HttpHeaders({ Authorization: `Bearer ${token}` }) : undefined;
    return this.http.get<{
      isLoggedIn: boolean;
      totalActive: number;
      claimedCount: number;
      vouchers: VoucherDetail[];
    }>('/api/user-vouchers/available', { headers });
  }

  claimVoucher(voucherId: string, token: string): Observable<ClaimVoucherResponse> {
    const headers = new HttpHeaders({ Authorization: `Bearer ${token}` });
    return this.http.post<ClaimVoucherResponse>(
      '/api/user-vouchers/claim',
      { voucherId },
      { headers }
    );
  }

  claimAllVouchers(token: string): Observable<ClaimVoucherResponse> {
    const headers = new HttpHeaders({ Authorization: `Bearer ${token}` });
    return this.http.post<ClaimVoucherResponse>(
      '/api/user-vouchers/claim-all',
      {},
      { headers }
    );
  }
}
