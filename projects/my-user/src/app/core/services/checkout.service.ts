import { HttpClient, HttpHeaders } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { map, Observable } from 'rxjs';

export type VoucherType = 'shipping' | 'percent' | 'fixed';

export type PaymentStatusId = 'awaiting_payment' | 'paid' | 'expired' | 'cancelled';

export interface OrderPaymentInfo {
  id: string;
  orderId: string;
  paymentCode: string;
  amountDue: number;
  currency: string;
  methodId: string;
  provider: string;
  statusId: PaymentStatusId;
  expiresAt: string;
  paidAt: string | null;
  isExpired: boolean;
  isPayable: boolean;
  qrCodeUrl: string;
  bankCode: string;
  bankName: string;
  accountNumber: string;
  accountName: string;
}

const VIETQR_BANK_NAMES: Readonly<Record<string, string>> = {
  '970422': 'MB Bank (Ngân hàng Quân Đội)',
  '970436': 'Vietcombank (Ngân hàng Ngoại thương)',
  '970415': 'VietinBank (Ngân hàng Công thương)',
  '970418': 'BIDV (Ngân hàng Đầu tư và Phát triển)',
  '970407': 'Techcombank (Ngân hàng Kỹ thương)',
  '970416': 'ACB (Ngân hàng Á Châu)',
  '970423': 'TPBank (Ngân hàng Tiên Phong)',
  '970432': 'VPBank (Ngân hàng Việt Nam Thịnh Vượng)',
  '970405': 'Agribank (Ngân hàng NN&PTNT)',
  '970403': 'Sacombank (Ngân hàng Sài Gòn Thương Tín)',
  '970437': 'HDBank (Ngân hàng Phát triển TP.HCM)',
  '970441': 'VIB (Ngân hàng Quốc Tế)',
  '970443': 'SHB (Ngân hàng Sài Gòn - Hà Nội)',
  '970448': 'OCB (Ngân hàng Phương Đông)',
  '970426': 'MSB (Ngân hàng Hàng Hải)',
  '970454': 'BVBank (Ngân hàng Bản Việt)',
};

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
    variantName?: string;
    variantIndex?: number | null;
  }>;
  payment: {
    method: string;
    methodId?: string;
    status: string;
    statusId?: string;
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

  createOrderPayment(orderId: string, token: string): Observable<OrderPaymentInfo> {
    return this.http.post<unknown>(
      `/api/orders/${encodeURIComponent(orderId)}/payment`,
      {},
      { headers: new HttpHeaders({ Authorization: `Bearer ${token}` }) },
    ).pipe(
      map((response) => this.parsePaymentResponse(response)),
    );
  }

  getOrderPaymentStatus(orderId: string, token: string): Observable<OrderPaymentInfo> {
    return this.http.get<unknown>(
      `/api/orders/${encodeURIComponent(orderId)}/payment`,
      { headers: new HttpHeaders({ Authorization: `Bearer ${token}` }) },
    ).pipe(
      map((response) => this.parsePaymentResponse(response)),
    );
  }

  private parsePaymentResponse(response: unknown): OrderPaymentInfo {
    const raw = this.isRecord(response) && this.isRecord(response['payment'])
      ? response['payment']
      : this.isRecord(response)
        ? response
        : null;
    if (!raw) {
      throw new Error('Máy chủ trả về dữ liệu thanh toán không hợp lệ.');
    }

    const id = typeof raw['id'] === 'string'
      ? raw['id'].trim()
      : typeof raw['_id'] === 'string'
        ? raw['_id'].trim()
        : '';
    const orderId = typeof raw['orderId'] === 'string' ? raw['orderId'].trim() : '';
    const paymentCode = typeof raw['paymentCode'] === 'string' ? raw['paymentCode'].trim() : '';
    const amountDue = Number(raw['amountDue']);
    const statusId = raw['statusId'];
    const expiresAt = typeof raw['expiresAt'] === 'string' ? raw['expiresAt'].trim() : '';

    if (
      !id
      || !orderId
      || !paymentCode
      || !Number.isFinite(amountDue)
      || amountDue < 0
      || (statusId !== 'awaiting_payment' && statusId !== 'paid' && statusId !== 'expired' && statusId !== 'cancelled')
      || !expiresAt
    ) {
      throw new Error('Dữ liệu thanh toán từ máy chủ thiếu thông tin bắt buộc.');
    }

    const qrCodeUrl = typeof raw['qrCodeUrl'] === 'string' ? raw['qrCodeUrl'].trim() : '';
    const parsedQrMeta = this.extractBankMetaFromQrUrl(qrCodeUrl);
    const bankCode = typeof raw['bankCode'] === 'string' && raw['bankCode'].trim()
      ? raw['bankCode'].trim()
      : parsedQrMeta.bankCode;
    const bankName = typeof raw['bankName'] === 'string' && raw['bankName'].trim()
      ? raw['bankName'].trim()
      : VIETQR_BANK_NAMES[bankCode]
        ? `${VIETQR_BANK_NAMES[bankCode]} (${bankCode})`
        : bankCode;
    const accountNumber = typeof raw['accountNumber'] === 'string' && raw['accountNumber'].trim()
      ? raw['accountNumber'].trim()
      : parsedQrMeta.accountNumber;
    const accountName = typeof raw['accountName'] === 'string' && raw['accountName'].trim()
      ? raw['accountName'].trim()
      : parsedQrMeta.accountName;

    return {
      id,
      orderId,
      paymentCode,
      amountDue,
      currency: typeof raw['currency'] === 'string' && raw['currency'].trim() ? raw['currency'].trim() : 'VND',
      methodId: typeof raw['methodId'] === 'string' && raw['methodId'].trim() ? raw['methodId'].trim() : 'bank_transfer',
      provider: typeof raw['provider'] === 'string' && raw['provider'].trim() ? raw['provider'].trim() : 'sepay',
      statusId,
      expiresAt,
      paidAt: typeof raw['paidAt'] === 'string' && raw['paidAt'].trim() ? raw['paidAt'].trim() : null,
      isExpired: raw['isExpired'] === true || statusId === 'expired',
      isPayable: raw['isPayable'] === true && statusId === 'awaiting_payment',
      qrCodeUrl,
      bankCode,
      bankName,
      accountNumber,
      accountName,
    };
  }

  private extractBankMetaFromQrUrl(qrCodeUrl: string): {
    bankCode: string;
    accountNumber: string;
    accountName: string;
  } {
    if (!qrCodeUrl) {
      return { bankCode: '', accountNumber: '', accountName: '' };
    }
    try {
      const url = new URL(qrCodeUrl);
      const accountName = (url.searchParams.get('accountName') ?? '').trim();
      const match = /\/image\/([^/?]+?)(?:\.[a-zA-Z0-9]+)?$/.exec(url.pathname);
      if (!match?.[1]) {
        return { bankCode: '', accountNumber: '', accountName };
      }
      const segments = match[1].split('-').map((segment) => decodeURIComponent(segment));
      if (segments.length >= 3) {
        return {
          bankCode: segments[0]?.trim() ?? '',
          accountNumber: segments.slice(1, -1).join('-').trim(),
          accountName,
        };
      }
      if (segments.length === 2) {
        return {
          bankCode: segments[0]?.trim() ?? '',
          accountNumber: segments[1]?.trim() ?? '',
          accountName,
        };
      }
      return { bankCode: '', accountNumber: '', accountName };
    } catch {
      return { bankCode: '', accountNumber: '', accountName: '' };
    }
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
