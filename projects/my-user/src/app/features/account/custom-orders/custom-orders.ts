import { UserSocketService } from '../../../core/services/user-socket.service';
import { HttpClient, HttpErrorResponse, HttpHeaders, HttpParams } from '@angular/common/http';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { ChangeDetectorRef, Component, inject, OnInit, OnDestroy, PLATFORM_ID } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { firstValueFrom, Subscription } from 'rxjs';
import { DialogService } from '../../../core/services/dialog.service';

type QuoteDecision = 'pending' | 'accepted' | 'rejected' | 'negotiating';
type QuoteResponse = Exclude<QuoteDecision, 'pending'>;
interface QuoteNegotiation {
  proposedPrice: number;
  note: string;
  requestedAt: string;
  respondedAt: string;
}
interface QuoteDetails {
  price: number;
  date: string;
  note: string;
  version: number;
  decision: QuoteDecision;
  negotiation: QuoteNegotiation | null;
}

interface CustomerDesignRequest {
  quote: QuoteDetails | null;
  quoteHistory: QuoteDetails[];
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
  imports: [CommonModule, RouterLink, DatePipe, FormsModule],
  selector: 'app-custom-orders',
  styleUrl: './custom-orders.css',
  templateUrl: './custom-orders.html',
})
export class CustomOrders implements OnInit, OnDestroy {
  private refreshTimer: any;
  private detailRevision = 0;
  private quoteUpdates?: Subscription;
  private readonly dialog = inject(DialogService);
  responseBusy = false;
  responseError = '';
  dealingVersion = 0;
  desiredPrice: number | null = null;
  dealNote = '';
  private readonly http = inject(HttpClient);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly changeDetectorRef = inject(ChangeDetectorRef);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
  private readonly socket = inject(UserSocketService);

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
    if (this.isBrowser) {
      this.quoteUpdates = this.socket.onUserUpdate('customOrders').subscribe(event => {
        if (!this.requestSlug || event.id === this.requestSlug) this.refreshSilently();
      });
    }
    this.route.paramMap.subscribe((params) => {
      this.requestSlug = params.get('slug') || '';
      this.activeRequest = null;
      this.detailRevision++;
      this.dealingVersion = 0;
      this.responseError = '';
      if (!this.isBrowser) return;

      if (!this.getToken()) {
        this.requiresLogin = true;
        this.isLoading = false;
        return;
      }

      this.requiresLogin = false;
      if (this.requestSlug) this.loadRequest(this.requestSlug);
      else this.loadRequests();
      this.startAutoRefresh();
    });
  }

  ngOnDestroy(): void {
    this.stopAutoRefresh();
    this.quoteUpdates?.unsubscribe();
    this.detailRevision++;
  }

  private startAutoRefresh(): void {
    this.stopAutoRefresh();
    if (!this.isBrowser) return;
    this.refreshTimer = setInterval(() => {
      this.refreshSilently();
    }, 4000);
  }

  private stopAutoRefresh(): void {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
  }

  private refreshSilently(): void {
    if (!this.isBrowser || this.isLoading || !this.getToken()) return;
    const token = this.getToken();
    if (!token) return;

    if (this.requestSlug) {
      if (this.responseBusy) return;
      const revision = ++this.detailRevision;
      const slug = this.requestSlug;
      this.http.get<unknown>(`/api/custom-orders/mine/${encodeURIComponent(this.requestSlug)}`, {
        headers: this.authorizationHeaders(token)
      }).subscribe({
        next: (res) => {
          if (revision !== this.detailRevision || slug !== this.requestSlug || this.responseBusy) return;
          const parsed = this.parseRequest(res);
          if (parsed) {
            this.activeRequest = parsed;
            this.changeDetectorRef.markForCheck();
          }
        },
        error: () => {}
      });
    } else {
      let params = new HttpParams().set('page', this.currentPage).set('limit', 5);
      if (this.selectedStatus) {
        params = params.set('status', this.selectedStatus);
      }
      this.http.get<unknown>('/api/custom-orders/mine', {
        headers: this.authorizationHeaders(token),
        params
      }).subscribe({
        next: (res) => {
          const pageData = this.parsePage(res);
          if (pageData) {
            this.requests = pageData.orders;
            this.totalPages = pageData.totalPages;
            this.totalCount = pageData.total;
            this.activeCount = pageData.activeCount;
            this.changeDetectorRef.markForCheck();
          }
        },
        error: () => {}
      });
    }
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

    const revision = ++this.detailRevision;
    this.isLoading = true;
    this.errorMessage = '';
    this.http.get<unknown>(`/api/custom-orders/mine/${encodeURIComponent(slug)}`, {
      headers: this.authorizationHeaders(token),
    }).subscribe({
      next: (response) => {
        if (revision !== this.detailRevision) return;
        this.activeRequest = this.parseRequest(response);
        if (!this.activeRequest) this.errorMessage = 'Dữ liệu yêu cầu thiết kế nhận được không hợp lệ.';
        this.isLoading = false;
        this.changeDetectorRef.markForCheck();
      },
      error: (error: unknown) => {
        if (revision === this.detailRevision) this.handleRequestError(error, 'Không thể tải chi tiết yêu cầu thiết kế.');
      },
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
      quote: this.parseQuote(value),
      quoteHistory: Array.isArray(value['quoteHistory'])
        ? value['quoteHistory'].map(item => this.parseQuote(item)).filter((item): item is QuoteDetails => item !== null) : [],
    };
  }

  private parseQuote(value: unknown): QuoteDetails | null {
    if (!this.isRecord(value)) return null;
    const price = value['quotedPrice'];
    const version = value['quoteVersion'];
    const decision = value['quoteDecision'];
    const date = this.text(value['quoteDate']);
    if (typeof price !== 'number' || !Number.isFinite(price) || price <= 0
      || typeof version !== 'number' || !Number.isSafeInteger(version) || version < 1
      || !date || !['pending', 'accepted', 'rejected', 'negotiating'].includes(String(decision))) return null;
    const rawDeal = value['quoteNegotiation'];
    const proposedPrice = this.isRecord(rawDeal) ? rawDeal['proposedPrice'] : null;
    const negotiation = this.isRecord(rawDeal) && typeof proposedPrice === 'number' && Number.isFinite(proposedPrice) && proposedPrice > 0
      ? { proposedPrice, note: this.text(rawDeal['note']), requestedAt: this.text(rawDeal['requestedAt']),
          respondedAt: this.text(rawDeal['respondedAt']) } : null;
    return { price, date, note: this.text(value['quoteNote']), version, decision: decision as QuoteDecision, negotiation };
  }

  quoteDecisionLabel(decision: QuoteDecision): string {
    return { pending: 'Đang chờ bạn phản hồi', accepted: 'Đã đồng ý báo giá', rejected: 'Đã từ chối báo giá',
      negotiating: 'Đang chờ cửa hàng phản hồi thương lượng' }[decision];
  }

  formatQuotePrice(price: number): string {
    return price.toLocaleString('vi-VN') + ' đ';
  }

  openNegotiation(version: number): void {
    if (this.responseBusy) return;
    this.dealingVersion = version;
    this.desiredPrice = null;
    this.dealNote = '';
    this.responseError = '';
  }

  get validNegotiation(): boolean {
    return this.desiredPrice !== null && Number.isFinite(this.desiredPrice) && this.desiredPrice > 0 && this.dealNote.length <= 1000;
  }

  async respondToQuote(decision: QuoteResponse): Promise<void> {
    const request = this.activeRequest;
    const quote = request?.quote;
    const token = this.getToken();
    if (this.responseBusy || !request || !quote || !token || request.status !== 'quoted' || quote.decision !== 'pending') return;
    if (decision === 'negotiating' && (this.dealingVersion !== quote.version || !this.validNegotiation)) return;

    this.responseBusy = true;
    this.responseError = '';
    try {
      if (decision !== 'negotiating') {
        const accept = decision === 'accepted';
        const confirmed = await this.dialog.confirm(accept
          ? 'Bạn đồng ý với mức giá ' + this.formatQuotePrice(quote.price) + '?'
          : 'Từ chối báo giá sẽ kết thúc yêu cầu thiết kế này.',
          'Xác nhận phản hồi', accept ? 'Đồng ý báo giá' : 'Từ chối báo giá');
        if (!confirmed || this.requestSlug !== request.id) return;
      }
      ++this.detailRevision;
      const payload = { decision, quoteVersion: quote.version,
        ...(decision === 'negotiating' ? { proposedPrice: this.desiredPrice, note: this.dealNote } : {}) };
      const saved = await firstValueFrom(this.http.post<unknown>(
        '/api/custom-orders/mine/' + encodeURIComponent(request.id) + '/quote-response', payload,
        { headers: this.authorizationHeaders(token) }));
      if (this.requestSlug !== request.id) return;
      const updated = this.parseRequest(saved);
      if (updated?.id !== request.id || updated.quote?.decision !== decision || updated.quote.version !== quote.version) {
        this.responseError = 'Máy chủ chưa xác nhận phản hồi. Vui lòng kiểm tra lại báo giá.';
        this.loadRequest();
        return;
      }
      this.activeRequest = updated;
      this.dealingVersion = 0;
    } catch (error) {
      if (this.requestSlug !== request.id) return;
      this.responseError = error instanceof HttpErrorResponse && error.error?.message
        ? error.error.message : 'Không thể gửi phản hồi. Vui lòng thử lại.';
      if (error instanceof HttpErrorResponse && error.status === 409) {
        this.dealingVersion = 0;
        this.loadRequest();
      }
    } finally {
      this.responseBusy = false;
      this.changeDetectorRef.markForCheck();
    }
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
