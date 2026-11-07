import { HttpClient, HttpErrorResponse, HttpHeaders, HttpParams } from '@angular/common/http';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { ChangeDetectorRef, Component, inject, OnInit, PLATFORM_ID } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { DatePipe } from '@angular/common';

interface CustomerDesignRequest {
  id: string;
  requestName: string;
  imageUrl: string;
  size: string;
  beadType: string;
  status: string;
  createdAt: string;
  description: string;
  imageNote: string;
}

interface DesignRequestPage {
  orders: CustomerDesignRequest[];
  total: number;
  activeCount: number;
  page: number;
  totalPages: number;
}

const REQUEST_STATUSES = [
  { id: '', label: 'Tất cả trạng thái' },
  { id: 'pending', label: 'Đang chờ xử lý' },
  { id: 'quoted', label: 'Đã báo giá' },
  { id: 'processing', label: 'Đang xử lý' },
  { id: 'completed', label: 'Hoàn thành' },
  { id: 'cancelled', label: 'Đã hủy' },
];

const REQUEST_STATUS_LABELS = new Map(
  REQUEST_STATUSES.filter((status) => status.id).map((status) => [status.id, status.label]),
);

@Component({
  imports: [CommonModule, RouterLink, DatePipe],
  selector: 'app-custom-orders',
  styleUrl: './custom-orders.css',
  templateUrl: './custom-orders.html',
})
export class CustomOrders implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly changeDetectorRef = inject(ChangeDetectorRef);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  readonly statuses = REQUEST_STATUSES;
  requests: CustomerDesignRequest[] = [];
  selectedStatus = '';
  currentPage = 1;
  totalPages = 0;
  totalCount = 0;
  activeCount = 0;
  activeRequest: CustomerDesignRequest | null = null;
  requestSlug = '';
  isLoading = true;
  requiresLogin = false;
  errorMessage = '';

  get pageNumbers(): number[] {
    return Array.from({ length: this.totalPages }, (_, index) => index + 1);
  }

  ngOnInit(): void {
    this.route.paramMap.subscribe((params) => {
      this.requestSlug = params.get('slug') || '';
      this.activeRequest = null;
      if (!this.isBrowser) return;

      if (!this.getToken()) {
        this.requiresLogin = true;
        this.isLoading = false;
        return;
      }

      this.requiresLogin = false;
      if (this.requestSlug) this.loadRequest(this.requestSlug);
      else this.loadRequests();
    });
  }

  loadRequests(page = 1): void {
    const token = this.getToken();
    if (!token) {
      this.requiresLogin = true;
      this.isLoading = false;
      return;
    }

    this.currentPage = page;
    this.isLoading = true;
    this.errorMessage = '';
    this.activeRequest = null;
    let params = new HttpParams().set('page', page).set('limit', 5);
    if (this.selectedStatus) params = params.set('status', this.selectedStatus);

    this.http.get<unknown>('/api/custom-orders/mine', {
      headers: this.authorizationHeaders(token),
      params,
    }).subscribe({
      next: (response) => {
        const pageData = this.parsePage(response);
        if (!pageData) {
          this.errorMessage = 'Dữ liệu yêu cầu thiết kế nhận được không hợp lệ.';
          this.isLoading = false;
          this.changeDetectorRef.markForCheck();
          return;
        }

        this.requests = pageData.orders;
        this.totalCount = pageData.total;
        this.activeCount = pageData.activeCount;
        this.currentPage = pageData.page;
        this.totalPages = pageData.totalPages;
        this.isLoading = false;
        this.changeDetectorRef.markForCheck();
      },
      error: (error: unknown) => this.handleRequestError(error, 'Không thể tải yêu cầu thiết kế.'),
    });
  }

  loadRequest(slug = this.requestSlug): void {
    const token = this.getToken();
    if (!token || !slug) return;

    this.isLoading = true;
    this.errorMessage = '';
    this.http.get<unknown>(`/api/custom-orders/mine/${encodeURIComponent(slug)}`, {
      headers: this.authorizationHeaders(token),
    }).subscribe({
      next: (response) => {
        this.activeRequest = this.parseRequest(response);
        if (!this.activeRequest) this.errorMessage = 'Dữ liệu yêu cầu thiết kế nhận được không hợp lệ.';
        this.isLoading = false;
        this.changeDetectorRef.markForCheck();
      },
      error: (error: unknown) => this.handleRequestError(error, 'Không thể tải chi tiết yêu cầu thiết kế.'),
    });
  }

  selectStatus(status: string): void {
    if (this.selectedStatus === status) return;
    this.selectedStatus = status;
    this.loadRequests(1);
  }

  onStatusChange(event: Event): void {
    const target = event.currentTarget;
    if (target instanceof HTMLSelectElement) this.selectStatus(target.value);
  }

  goToPage(page: number): void {
    if (page < 1 || page > this.totalPages || page === this.currentPage) return;
    this.loadRequests(page);
  }

  statusLabel(status: string): string {
    return REQUEST_STATUS_LABELS.get(status) || status;
  }

  statusClass(status: string): string {
    return `request-status--${status || 'unknown'}`;
  }

  createRequest(): void {
    void this.router.navigate(['/custom-order']);
  }

  backToRequests(): void {
    void this.router.navigate(['/custom-order-list']);
  }

  signIn(): void {
    const returnUrl = this.requestSlug
      ? `/custom-order-list/${encodeURIComponent(this.requestSlug)}`
      : '/custom-order-list';
    void this.router.navigate(['/login'], { queryParams: { returnUrl } });
  }

  private getToken(): string {
    const token = localStorage.getItem('authToken');
    return localStorage.getItem('isLoggedIn') === 'true' ? token || '' : '';
  }

  private authorizationHeaders(token: string): HttpHeaders {
    return new HttpHeaders({ Authorization: `Bearer ${token}` });
  }

  private parsePage(value: unknown): DesignRequestPage | null {
    if (!this.isRecord(value) || !Array.isArray(value['orders'])) return null;
    const orders = value['orders'].map((item) => this.parseRequest(item));
    if (orders.some((item) => item === null)) return null;

    const total = this.nonNegativeInteger(value['total']);
    const activeCount = this.nonNegativeInteger(value['activeCount']);
    const page = this.nonNegativeInteger(value['page']);
    const totalPages = this.nonNegativeInteger(value['totalPages']);
    if (total === null || activeCount === null || page === null || totalPages === null) return null;

    return {
      orders: orders.filter((item): item is CustomerDesignRequest => item !== null),
      total,
      activeCount,
      page,
      totalPages,
    };
  }

  private parseRequest(value: unknown): CustomerDesignRequest | null {
    if (!this.isRecord(value) || typeof value['id'] !== 'string') return null;
    return {
      id: value['id'],
      requestName: this.text(value['requestName']),
      imageUrl: this.normalizeImage(this.text(value['imageUrl'])),
      size: this.text(value['size']),
      beadType: this.text(value['beadType']),
      status: this.text(value['status']),
      createdAt: this.text(value['createdAt']),
      description: this.text(value['description']),
      imageNote: this.text(value['imageNote']),
    };
  }

  private handleRequestError(error: unknown, fallback: string): void {
    console.error('Không thể tải yêu cầu thiết kế:', error);
    this.isLoading = false;
    if (error instanceof HttpErrorResponse && error.status === 401) {
      this.requiresLogin = true;
      this.errorMessage = '';
    } else {
      this.errorMessage = error instanceof HttpErrorResponse && error.status === 404
        ? 'Không tìm thấy yêu cầu thiết kế.'
        : fallback;
    }
    this.changeDetectorRef.markForCheck();
  }

  private normalizeImage(value: string): string {
    if (value.startsWith('/images/')) return `/api${value}`;
    if (value.startsWith('images/')) return `/api/${value}`;
    return value;
  }

  private text(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
  }

  private nonNegativeInteger(value: unknown): number | null {
    return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }
}
