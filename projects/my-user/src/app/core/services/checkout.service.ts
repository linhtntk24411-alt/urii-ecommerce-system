import { HttpClient, HttpHeaders } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { map, Observable } from 'rxjs';

export type VoucherType = 'shipping' | 'percent' | 'fixed';

export interface CheckoutVoucher {
  id: string;
  code: string;
  name: string;
  type: VoucherType;
  discountValue: number;
  minOrder: number;
  maxDiscount?: number;
}

export interface CreateOrderPayload {
  userName: string;
  date: string;
  status: string;
  statusType: string;
  total: string;
  note?: string;
  voucher?: {
    voucherId: string;
    discountAmount: number;
  };
  items: Array<{
    productId: string;
    name: string;
    price: number;
    quantity: number;
    image: string;
  }>;
  payment: {
    method: string;
    status: string;
  };
  shipping: {
    method: string;
    fee: number;
  };
  address: {
    name: string;
    phone: string;
    address: string;
  };
}

@Injectable({ providedIn: 'root' })
export class CheckoutService {
  private readonly http = inject(HttpClient);

  getCurrentUser(token: string): Observable<unknown> {
    return this.http.get<unknown>('/api/auth/me', {
      headers: new HttpHeaders({ Authorization: `Bearer ${token}` }),
    });
  }

  getMyAvailableVouchers(token: string): Observable<CheckoutVoucher[]> {
    return this.http.get<unknown>('/api/user-vouchers/available-to-use', {
      headers: new HttpHeaders({ Authorization: `Bearer ${token}` }),
    }).pipe(
      map((response) => this.parseOwnedVouchers(response)),
    );
  }

  createOrder(payload: CreateOrderPayload, token: string): Observable<unknown> {
    return this.http.post<unknown>('/api/orders', payload, {
      headers: new HttpHeaders({ Authorization: `Bearer ${token}` }),
    });
  }

  private parseVouchers(response: unknown): CheckoutVoucher[] {
    const records = Array.isArray(response)
      ? response
      : this.isRecord(response) && Array.isArray(response['vouchers'])
        ? response['vouchers']
        : null;
    if (!records) {
      throw new Error('Máy chủ trả về danh sách voucher không hợp lệ.');
    }

    return records.flatMap((record): CheckoutVoucher[] => {
      if (!this.isRecord(record)) return [];
      const code = record['code'];
      const name = record['name'];
      const type = record['type'];
      const value = Number(record['discountValue']);
      const minOrder = Number(record['minOrder'] ?? 0);
      const maxDiscount = record['maxDiscount'] === undefined
        ? undefined
        : Number(record['maxDiscount']);
      if (
        typeof code !== 'string'
        || typeof name !== 'string'
        || (type !== 'shipping' && type !== 'percent' && type !== 'fixed')
        || !Number.isFinite(value)
        || !Number.isFinite(minOrder)
        || (maxDiscount !== undefined && !Number.isFinite(maxDiscount))
      ) {
        return [];
      }

      const rawId = record['id'] ?? record['_id'];
      return [{
        id: typeof rawId === 'string' || typeof rawId === 'number' ? String(rawId) : code,
        code: code.trim().toUpperCase(),
        name,
        type,
        discountValue: value,
        minOrder,
        maxDiscount,
      }];
    });
  }

  private parseOwnedVouchers(response: unknown): CheckoutVoucher[] {
    if (!Array.isArray(response)) {
      throw new Error('Máy chủ trả về kho voucher của tài khoản không hợp lệ.');
    }

    return response.flatMap((entry: unknown): CheckoutVoucher[] => {
      if (!this.isRecord(entry) || entry['isUsed'] === true || !this.isRecord(entry['voucher'])) {
        return [];
      }
      return this.parseVouchers([entry['voucher']]);
    });
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }
}
