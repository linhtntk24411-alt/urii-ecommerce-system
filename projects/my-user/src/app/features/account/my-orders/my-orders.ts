import { HttpClient, HttpErrorResponse, HttpHeaders, HttpParams } from '@angular/common/http';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { ChangeDetectorRef, Component, inject, OnInit, PLATFORM_ID } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';

interface OrderItem {
  name: string;
  quantity: number | null;
  unitPrice: number | null;
  image: string;
}

interface CustomerOrder {
  slug: string;
  statusId: string;
  status: string;
  date: string;
  totalAmount: number | null;
  total: string;
  items: OrderItem[];
  addressName: string;
  addressPhone: string;
  addressText: string;
  paymentMethod: string;
  paymentStatus: string;
  shippingMethod: string;
  trackingNumber: string;
}

interface OrderPage {
  orders: CustomerOrder[];
  total: number;
  page: number;
  totalPages: number;
}

const ORDER_STATUSES = [
  { id: '', label: 'Tất cả' },
  { id: 'pending', label: 'Chờ xác nhận' },
  { id: 'processing', label: 'Chờ lấy hàng' },
  { id: 'shipping', label: 'Chờ giao hàng' },
  { id: 'completed', label: 'Đã giao' },
  { id: 'returned', label: 'Trả hàng' },
  { id: 'cancelled', label: 'Đã hủy' },
];

const STATUS_LABELS = new Map(ORDER_STATUSES.filter((status) => status.id).map((status) => [status.id, status.label]));

@Component({
  imports: [CommonModule, RouterLink],
  selector: 'app-my-orders',
  styleUrl: './my-orders.css',
  templateUrl: './my-orders.html',
})
export class MyOrders implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly changeDetectorRef = inject(ChangeDetectorRef);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  readonly statuses = ORDER_STATUSES;
  orders: CustomerOrder[] = [];
  selectedStatus = '';
  currentPage = 1;
  totalPages = 0;
  totalOrders = 0;
  activeOrder: CustomerOrder | null = null;
  orderSlug = '';
  isLoading = true;
  requiresLogin = false;
  errorMessage = '';

  get pageNumbers(): number[] {
    return Array.from({ length: this.totalPages }, (_, index) => index + 1);
  }

  ngOnInit(): void {
    this.route.paramMap.subscribe((params) => {
      const slug = params.get('slug') || '';
      this.orderSlug = slug;
      this.activeOrder = null;
      if (!this.isBrowser) return;

      if (!this.getToken()) {
        this.requiresLogin = true;
        this.isLoading = false;
        return;
      }

      this.requiresLogin = false;
      if (slug) this.loadOrder(slug);
      else this.loadOrders();
    });
  }

  loadOrders(page = 1): void {
    const token = this.getToken();
    if (!token) {
      this.requiresLogin = true;
      this.isLoading = false;
      return;
    }

    this.currentPage = page;
    this.isLoading = true;
    this.errorMessage = '';
    this.activeOrder = null;
    let params = new HttpParams().set('page', page).set('limit', 5);
    if (this.selectedStatus) params = params.set('statusId', this.selectedStatus);

    this.http.get<unknown>('/api/orders/mine', {
      headers: this.authorizationHeaders(token),
      params,
    }).subscribe({
      next: (response) => {
        const orderPage = this.parseOrderPage(response);
        if (!orderPage) {
          this.errorMessage = 'Dữ liệu đơn hàng nhận được không hợp lệ.';
          this.isLoading = false;
          this.changeDetectorRef.markForCheck();
          return;
        }
        this.orders = orderPage.orders;
        this.currentPage = orderPage.page;
        this.totalPages = orderPage.totalPages;
        this.totalOrders = orderPage.total;
        this.isLoading = false;
        this.changeDetectorRef.markForCheck();
      },
      error: (error: unknown) => this.handleRequestError(error, 'Không thể tải danh sách đơn hàng.'),
    });
  }

  loadOrder(slug = this.orderSlug): void {
    const token = this.getToken();
    if (!token || !slug) return;

    this.isLoading = true;
    this.errorMessage = '';
    this.http.get<unknown>(`/api/orders/mine/${encodeURIComponent(slug)}`, {
      headers: this.authorizationHeaders(token),
    }).subscribe({
      next: (response) => {
        const order = this.parseOrder(response);
        if (!order) {
          this.errorMessage = 'Dữ liệu đơn hàng nhận được không hợp lệ.';
        } else {
          this.activeOrder = order;
        }
        this.isLoading = false;
        this.changeDetectorRef.markForCheck();
      },
      error: (error: unknown) => this.handleRequestError(error, 'Không thể tải chi tiết đơn hàng.'),
    });
  }

  selectStatus(statusId: string): void {
    if (this.selectedStatus === statusId) return;
    this.selectedStatus = statusId;
    this.loadOrders(1);
  }

  goToPage(page: number): void {
    if (page < 1 || page > this.totalPages || page === this.currentPage) return;
    this.loadOrders(page);
  }

  statusLabel(order: CustomerOrder): string {
    return STATUS_LABELS.get(order.statusId) || order.status || order.statusId;
  }

  formatTotal(order: CustomerOrder): string {
    if (order.total) return order.total;
    if (order.totalAmount === null) return '';
    return `${new Intl.NumberFormat('vi-VN').format(order.totalAmount)}đ`;
  }

  backToOrders(): void {
    void this.router.navigate(['/orders']);
  }

  signIn(): void {
    const returnUrl = this.orderSlug ? `/orders/${encodeURIComponent(this.orderSlug)}` : '/orders';
    void this.router.navigate(['/login'], { queryParams: { returnUrl } });
  }

  private getToken(): string {
    const token = localStorage.getItem('authToken');
    return localStorage.getItem('isLoggedIn') === 'true' ? token || '' : '';
  }

  private authorizationHeaders(token: string): HttpHeaders {
    return new HttpHeaders({ Authorization: `Bearer ${token}` });
  }

  private parseOrderPage(value: unknown): OrderPage | null {
    if (!this.isRecord(value) || !Array.isArray(value['orders'])) return null;
    const orders = value['orders'].map((order) => this.parseOrder(order));
    if (orders.some((order) => order === null)) return null;

    const total = this.nonNegativeInteger(value['total']);
    const page = this.nonNegativeInteger(value['page']);
    const totalPages = this.nonNegativeInteger(value['totalPages']);
    if (total === null || page === null || totalPages === null) return null;

    return {
      orders: orders.filter((order): order is CustomerOrder => order !== null),
      total,
      page,
      totalPages,
    };
  }

  private parseOrder(value: unknown): CustomerOrder | null {
    if (!this.isRecord(value)) return null;
    const rawId = value['id'] ?? value['_id'];
    if (typeof rawId !== 'string' && typeof rawId !== 'number') return null;
    if (value['items'] !== undefined && !Array.isArray(value['items'])) return null;
    const rawItems = Array.isArray(value['items']) ? value['items'] : [];
    const items: OrderItem[] = [];
    for (const item of rawItems) {
      if (!this.isRecord(item)) return null;
      items.push({
        name: this.text(item['name']),
        quantity: this.numberOrNull(item['quantity']),
        unitPrice: this.numberOrNull(item['unitPrice'] ?? item['price']),
        image: this.normalizeImage(this.text(item['image'])),
      });
    }
    const status = this.isRecord(value['status']) ? '' : this.text(value['status']);
    const payment = this.isRecord(value['payment']) ? value['payment'] : {};
    const shipping = this.isRecord(value['shipping']) ? value['shipping'] : {};
    const address = this.isRecord(value['address']) ? value['address'] : {};

    return {
      slug: String(rawId),
      statusId: this.text(value['statusId'] ?? value['statusType']),
      status,
      date: this.text(value['date'] ?? value['createdAt']),
      totalAmount: this.numberOrNull(value['totalAmount']),
      total: this.text(value['total']),
      items,
      addressName: this.text(address['name']),
      addressPhone: this.text(address['phone']),
      addressText: this.text(address['address']),
      paymentMethod: this.text(payment['method']),
      paymentStatus: this.text(payment['status'] ?? payment['statusId']),
      shippingMethod: this.text(shipping['method'] ?? shipping['methodId']),
      trackingNumber: this.text(shipping['trackingNumber']),
    };
  }

  private handleRequestError(error: unknown, fallback: string): void {
    console.error('Không thể tải dữ liệu đơn hàng:', error);
    this.isLoading = false;
    this.errorMessage = error instanceof HttpErrorResponse && error.status === 401
      ? 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.'
      : error instanceof HttpErrorResponse && error.status === 404
        ? 'Không tìm thấy đơn hàng.'
        : fallback;
    this.changeDetectorRef.markForCheck();
  }

  private text(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
  }

  private numberOrNull(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
  }

  private normalizeImage(value: string): string {
    if (value.startsWith('/images/')) return `/api${value}`;
    if (value.startsWith('images/')) return `/api/${value}`;
    return value;
  }

  private nonNegativeInteger(value: unknown): number | null {
    return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }
}
