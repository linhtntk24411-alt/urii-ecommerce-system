import { HttpClient, HttpErrorResponse, HttpHeaders, HttpParams } from '@angular/common/http';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { ChangeDetectorRef, Component, HostListener, inject, OnDestroy, OnInit, PLATFORM_ID } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Subscription } from 'rxjs';
import { AddressArea, AddressLookupService } from '../../../core/services/address-lookup.service';
import { UserSocketService } from '../../../core/services/user-socket.service';


interface DeliveryAddress {
  id: string;
  name: string;
  phone: string;
  detail: string;
  ward: string;
  province: string;
  fullAddress: string;
  isDefault: boolean;
}

interface OrderItem {
  productId?: string;
  name: string;
  quantity: number | null;
  unitPrice: number | null;
  originalPrice?: number | null;
  image: string;
  variantName?: string;
  slug?: string;
}

export interface OrderTimelineItem {
  statusId: string;
  status: string;
  time?: string;
  location?: string;
  note?: string;
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
  shippingCarrier?: string;
  trackingNumber: string;
  shippingFee?: number | null;
  estimatedDelivery?: string;
  timeline?: OrderTimelineItem[];
  shippingTimeline?: OrderTimelineItem[];
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
  { id: 'unreviewed', label: 'Chưa đánh giá' },
  { id: 'returned', label: 'Trả hàng' },
  { id: 'cancelled', label: 'Đã hủy' },
];

const STATUS_LABELS = new Map(ORDER_STATUSES.filter((status) => status.id && status.id !== 'unreviewed').map((status) => [status.id, status.label]));

@Component({
  imports: [CommonModule, FormsModule, RouterLink],
  selector: 'app-my-orders',
  styleUrl: './my-orders.css',
  templateUrl: './my-orders.html',
})
export class MyOrders implements OnInit, OnDestroy {
  private readonly http = inject(HttpClient);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly changeDetectorRef = inject(ChangeDetectorRef);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private refreshSubscription: Subscription | null = null;

  
  private readonly addressLookup = inject(AddressLookupService);
  private readonly socket = inject(UserSocketService);

  // Address change modal for pending orders
  addressModalOpen = false;
  addressTargetOrder: CustomerOrder | null = null;
  savedAddresses: DeliveryAddress[] = [];
  selectedAddressId: string | null = null;
  addAddressFormOpen = false;
  addressModalError = '';
  isSavingAddress = false;
  addressSaveSuccess = false;

  provinces: AddressArea[] = [];
  wards: AddressArea[] = [];
  selectedProvinceCode: number | null = null;
  selectedWardCode: number | null = null;
  loadingProvinces = false;
  loadingWards = false;

  readonly newAddress = { name: '', phone: '', detail: '', isDefault: false };

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

  // Unreviewed orders & reviews integration
  eligibleOrders: Array<Record<string, unknown>> = [];
  unreviewedOrderIds = new Set<string>();
  statusCounts: Record<string, number> = {
    '': 0,
    pending: 0,
    processing: 0,
    shipping: 0,
    completed: 0,
    returned: 0,
    cancelled: 0,
  };
  isReviewModalOpen = false;
  selectedReviewOrder: CustomerOrder | null = null;
  selectedReviewItem: OrderItem | null = null;
  reviewRating = 5;
  reviewHoverRating = 0;
  reviewContent = '';
  isSubmittingReview = false;
  reviewSubmitSuccess = false;
  reviewErrorMessage = '';
  showTrackingView = false;
  copiedText = '';

  // Return & Refund flow (Khớp giao diện Shopee như ảnh chụp)
  returnModalOpen = false;
  returnStep: 'situation' | 'form' = 'situation';
  returnReasonSheetOpen = false;
  returnTargetOrder: CustomerOrder | null = null;
  selectedSituation: 'damaged' | 'not_received' | null = null;
  selectedReturnReason: { id: string; label: string; requiresImage?: boolean; requiresVideo?: boolean } | null = null;
  pendingReturnReason: { id: string; label: string; requiresImage?: boolean; requiresVideo?: boolean } | null = null;
  returnDescription = '';
  returnEvidenceList: Array<{ type: 'image' | 'video'; url: string; name?: string }> = [];
  isSubmittingReturn = false;
  returnErrorMessage = '';
  returnSubmitSuccess = false;

  get returnImageCount(): number {
    return this.returnEvidenceList.filter((e) => e.type === 'image').length;
  }

  get returnVideoCount(): number {
    return this.returnEvidenceList.filter((e) => e.type === 'video').length;
  }

  readonly returnReasonsList = [
    { id: 'MISSING_QUANTITY', label: 'Thiếu hàng', requiresImage: true },
    { id: 'WRONG_ITEM', label: 'Người bán gửi sai hàng', requiresImage: true },
    { id: 'DAMAGED', label: 'Hàng bể vỡ', requiresImage: true, requiresVideo: true },
    { id: 'DEFECTIVE', label: 'Hàng lỗi, không hoạt động', requiresImage: true, requiresVideo: true },
    { id: 'EXPIRED', label: 'Hàng hết hạn sử dụng', requiresImage: true },
    { id: 'NOT_AS_DESCRIBED', label: 'Khác với mô tả', requiresImage: true },
  ];

  private ordersCache = new Map<string, { orders: CustomerOrder[]; page: number; totalPages: number; total: number }>();

  get pageNumbers(): number[] {
    return Array.from({ length: this.totalPages }, (_, index) => index + 1);
  }

  get displayedOrders(): CustomerOrder[] {
    if (this.selectedStatus === 'unreviewed') {
      const fromCurrent = this.orders.filter((order) => this.isOrderUnreviewed(order));
      if (fromCurrent.length > 0) return fromCurrent;
      return this.eligibleOrders
        .map((order) => this.parseOrder(order))
        .filter((order): order is CustomerOrder => order !== null);
    }
    return this.orders;
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
        this.stopAutoRefresh();
        return;
      }

      this.requiresLogin = false;
      if (slug) this.loadOrder(slug);
      else this.loadOrders();
      this.startAutoRefresh();
      this.socket.onUserUpdate('orders').subscribe(() => this.refreshSilently());
      this.socket.onCrudChange('orders').subscribe(() => this.refreshSilently());
    });
  }

  ngOnDestroy(): void {
    this.stopAutoRefresh();
  }

  @HostListener('window:focus')
  onWindowFocus(): void {
    if (!this.isBrowser) return;
    this.refreshSilently();
    this.loadEligibleOrders();
    this.loadOrdersSummary();
  }

  private startAutoRefresh(): void {
    this.stopAutoRefresh();
    if (!this.isBrowser) return;
    this.refreshTimer = setInterval(() => {
      this.refreshSilently();
    }, 4000);
  }

  private stopAutoRefresh(): void {
    if (this.refreshTimer !== null) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
    if (this.refreshSubscription !== null) {
      this.refreshSubscription.unsubscribe();
      this.refreshSubscription = null;
    }
  }

  private refreshSilently(): void {
    if (this.isLoading || this.refreshSubscription !== null) return;
    const token = this.getToken();
    if (!token) return;

    if (this.orderSlug) {
      this.refreshSubscription = this.http.get<unknown>(`/api/orders/mine/${encodeURIComponent(this.orderSlug)}`, {
        headers: this.authorizationHeaders(token),
      }).subscribe({
        next: (response) => {
          this.refreshSubscription = null;
          const order = this.parseOrder(response);
          if (order) {
            this.activeOrder = order;
            this.changeDetectorRef.markForCheck();
          }
        },
        error: () => {
          this.refreshSubscription = null;
        },
      });
      return;
    }

    let params = new HttpParams().set('page', this.currentPage).set('limit', 5);
    if (this.selectedStatus && this.selectedStatus !== 'unreviewed') {
      params = params.set('statusId', this.selectedStatus);
    } else if (this.selectedStatus === 'unreviewed') {
      params = params.set('statusId', 'completed');
    }

    this.refreshSubscription = this.http.get<unknown>('/api/orders/mine', {
      headers: this.authorizationHeaders(token),
      params,
    }).subscribe({
      next: (response) => {
        this.refreshSubscription = null;
        const orderPage = this.parseOrderPage(response);
        if (orderPage) {
          this.orders = orderPage.orders;
          this.currentPage = orderPage.page;
          this.totalPages = orderPage.totalPages;
          this.totalOrders = orderPage.total;
          this.changeDetectorRef.markForCheck();
        }
      },
      error: () => {
        this.refreshSubscription = null;
      },
    });
  }

  loadOrders(page = 1, reloadSummary = true): void {
    this.refreshSubscription?.unsubscribe();
    this.refreshSubscription = null;
    const token = this.getToken();
    if (!token) {
      this.requiresLogin = true;
      this.isLoading = false;
      return;
    }

    this.currentPage = page;
    this.errorMessage = '';
    this.activeOrder = null;

    const cacheKey = `${this.selectedStatus}:${page}`;
    const cached = this.ordersCache.get(cacheKey);
    if (cached) {
      this.orders = cached.orders;
      this.currentPage = cached.page;
      this.totalPages = cached.totalPages;
      this.totalOrders = cached.total;
      this.isLoading = false;
      this.changeDetectorRef.markForCheck();
    } else {
      this.isLoading = true;
    }

    if (reloadSummary) {
      this.loadEligibleOrders();
      this.loadOrdersSummary();
    }

    let params = new HttpParams().set('page', page).set('limit', 5);
    if (this.selectedStatus && this.selectedStatus !== 'unreviewed') {
      params = params.set('statusId', this.selectedStatus);
    } else if (this.selectedStatus === 'unreviewed') {
      params = params.set('statusId', 'completed');
    }

    this.http.get<unknown>('/api/orders/mine', {
      headers: this.authorizationHeaders(token),
      params,
    }).subscribe({
      next: (response) => {
        const orderPage = this.parseOrderPage(response);
        if (!orderPage) {
          if (!cached) {
            this.errorMessage = 'Dữ liệu đơn hàng nhận được không hợp lệ.';
            this.isLoading = false;
            this.changeDetectorRef.markForCheck();
          }
          return;
        }
        this.orders = orderPage.orders;
        this.currentPage = orderPage.page;
        this.totalPages = orderPage.totalPages;
        this.totalOrders = orderPage.total;
        this.ordersCache.set(cacheKey, {
          orders: orderPage.orders,
          page: orderPage.page,
          totalPages: orderPage.totalPages,
          total: orderPage.total,
        });
        if (this.selectedStatus in this.statusCounts) {
          this.statusCounts[this.selectedStatus] = orderPage.total;
        }
        if (this.selectedStatus === '') {
          this.statusCounts[''] = orderPage.total;
        }
        this.isLoading = false;
        this.changeDetectorRef.markForCheck();
      },
      error: (error: unknown) => {
        if (!cached) {
          this.handleRequestError(error, 'Không thể tải danh sách đơn hàng.');
        }
      },
    });
  }

  loadEligibleOrders(): void {
    const token = this.getToken();
    if (!token) return;

    this.http.get<Array<Record<string, unknown>>>('/api/reviews/eligible-orders', {
      headers: this.authorizationHeaders(token),
    }).subscribe({
      next: (response) => {
        if (!Array.isArray(response)) return;
        this.eligibleOrders = response;
        this.unreviewedOrderIds = new Set(
          response
            .map((o) => (this.isRecord(o) ? String(o['id'] ?? o['slug'] ?? o['_id'] ?? '') : ''))
            .filter(Boolean)
        );
        this.changeDetectorRef.markForCheck();
      },
      error: () => {
        // Silently ignore if review API fails
      },
    });
  }

  loadOrdersSummary(): void {
    const token = this.getToken();
    if (!token) return;

    this.http.get<{ counts?: Record<string, number> }>('/api/orders/mine/summary', {
      headers: this.authorizationHeaders(token),
    }).subscribe({
      next: (response) => {
        if (response && response.counts && typeof response.counts === 'object') {
          this.statusCounts = {
            ...this.statusCounts,
            ...response.counts,
          };
          this.changeDetectorRef.markForCheck();
        }
      },
      error: () => {
        // Silently ignore if summary endpoint fails
      },
    });
  }

  getStatusCount(statusId: string): number {
    if (statusId === 'unreviewed') {
      return this.unreviewedOrderIds.size;
    }
    return this.statusCounts[statusId] ?? 0;
  }

  loadOrder(slug = this.orderSlug): void {
    this.refreshSubscription?.unsubscribe();
    this.refreshSubscription = null;
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

  isOrderUnreviewed(order: CustomerOrder): boolean {
    if (!order || order.statusId !== 'completed') return false;
    return this.unreviewedOrderIds.has(order.slug);
  }

  selectStatus(statusId: string): void {
    if (this.selectedStatus === statusId) return;
    this.selectedStatus = statusId;
    this.loadOrders(1, false);
  }

  goToPage(page: number): void {
    if (page < 1 || page > this.totalPages || page === this.currentPage) return;
    this.loadOrders(page, false);
  }

  statusLabel(order: CustomerOrder): string {
    if (order.status === 'Đã xác nhận') return 'Đã xác nhận';
    return STATUS_LABELS.get(order.statusId) || order.status || order.statusId;
  }

  totalItemCount(order: CustomerOrder): number {
    if (!order.items || !order.items.length) return 1;
    return order.items.reduce((sum, item) => sum + (item.quantity || 1), 0);
  }

  toggleTrackingView(show?: boolean): void {
    this.showTrackingView = typeof show === 'boolean' ? show : !this.showTrackingView;
    this.changeDetectorRef.markForCheck();
  }

  copyToClipboard(text: string): void {
    if (!text || !this.isBrowser) return;
    navigator.clipboard?.writeText(text).then(() => {
      this.copiedText = text;
      setTimeout(() => {
        if (this.copiedText === text) this.copiedText = '';
        this.changeDetectorRef.markForCheck();
      }, 2000);
      this.changeDetectorRef.markForCheck();
    }).catch(() => {});
  }

  formatTimelineTime(timeStr?: string): string {
    if (!timeStr) return '';
    try {
      const d = new Date(timeStr);
      if (!isNaN(d.getTime())) {
        const day = d.getDate();
        const month = d.getMonth() + 1;
        const hours = String(d.getHours()).padStart(2, '0');
        const minutes = String(d.getMinutes()).padStart(2, '0');
        return `${day} Thg ${month} ${hours}:${minutes}`;
      }
    } catch {}
    return timeStr;
  }

  getOrderTimeline(order: CustomerOrder): OrderTimelineItem[] {
    if (order.shippingTimeline && order.shippingTimeline.length > 0) {
      return [...order.shippingTimeline].reverse();
    }
    if (order.timeline && order.timeline.length > 0) {
      return [...order.timeline].reverse();
    }
    const list: OrderTimelineItem[] = [];
    const dateStr = order.date || '27/10/2026';
    if (order.statusId === 'completed') {
      list.push({ statusId: 'delivered', status: 'Giao hàng thành công', time: `${dateStr} 13:06`, location: 'Địa chỉ nhận hàng' });
      list.push({ statusId: 'out_for_delivery', status: 'Đơn hàng sẽ sớm được giao, vui lòng chú ý điện thoại', time: `${dateStr} 09:49`, location: 'Bưu cục giao hàng' });
      list.push({ statusId: 'in_transit', status: 'Đơn hàng đã đến trạm giao hàng tại khu vực của bạn', time: `${dateStr} 07:45`, location: 'Trạm giao hàng' });
      list.push({ statusId: 'dispatched', status: 'Đơn hàng đã đến kho phân loại', time: `${dateStr} 05:20`, location: 'Kho phân loại' });
      list.push({ statusId: 'received_by_carrier', status: 'Người bán đang chuẩn bị hàng', time: `${dateStr} 02:15`, location: 'Kho Urii' });
      list.push({ statusId: 'order_placed', status: 'Đơn hàng đã được đặt', time: `${dateStr} 00:11` });
    } else if (order.statusId === 'shipping') {
      list.push({ statusId: 'in_transit', status: 'Đơn hàng đang trên đường giao đến bạn', time: `${dateStr} 08:30`, location: 'Đang vận chuyển' });
      list.push({ statusId: 'dispatched', status: 'Đã xuất kho phân loại', time: `${dateStr} 05:20`, location: 'Kho phân loại' });
      list.push({ statusId: 'order_placed', status: 'Đơn hàng đã được đặt', time: `${dateStr} 00:11` });
    } else if (order.statusId === 'processing') {
      list.push({ statusId: 'preparing', status: 'Người bán đang chuẩn bị hàng', time: `${dateStr} 10:00`, location: 'Kho Urii' });
      list.push({ statusId: 'order_placed', status: 'Đơn hàng đã được đặt', time: `${dateStr} 00:11` });
    } else {
      list.push({ statusId: 'order_placed', status: 'Đơn hàng đã được đặt thành công', time: `${dateStr} 00:11` });
    }
    return list;
  }

  parseDate(dateStr?: string): Date | null {
    if (!dateStr) return null;
    if (dateStr.includes('/')) {
      const parts = dateStr.split('/');
      if (parts.length === 3) {
        const day = parseInt(parts[0], 10);
        const month = parseInt(parts[1], 10) - 1;
        const year = parseInt(parts[2], 10);
        return new Date(year, month, day);
      }
    }
    const d = new Date(dateStr);
    return isNaN(d.getTime()) ? null : d;
  }

  isReturnEligible(order: CustomerOrder): boolean {
    if (order.statusId !== 'completed') return false;
    const d = this.parseDate(order.date);
    if (!d) return true;
    const diffMs = Date.now() - d.getTime();
    const diffDays = diffMs / (1000 * 60 * 60 * 24);
    return diffDays <= 15; // Quy định cố định 15 ngày
  }

  getReturnDeadlineText(order: CustomerOrder): string {
    const d = this.parseDate(order.date) || new Date();
    const deadline = new Date(d.getTime() + 15 * 24 * 60 * 60 * 1000);
    return `${deadline.getDate()} Thg ${deadline.getMonth() + 1}`;
  }

  openChatbot(): void {
    if (!this.isBrowser) return;
    const chatFab = document.getElementById('chat-fab');
    if (chatFab) {
      chatFab.click();
    }
  }

  openReturnRequest(order: CustomerOrder, event?: Event): void {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }
    this.returnTargetOrder = order;
    this.returnStep = 'situation';
    this.selectedSituation = null;
    this.selectedReturnReason = null;
    this.pendingReturnReason = null;
    this.returnDescription = '';
    this.returnEvidenceList = [];
    this.isSubmittingReturn = false;
    this.returnErrorMessage = '';
    this.returnSubmitSuccess = false;
    this.returnReasonSheetOpen = false;
    this.returnModalOpen = true;
    this.changeDetectorRef.markForCheck();
  }

  closeReturnModal(): void {
    this.returnModalOpen = false;
    this.returnReasonSheetOpen = false;
    this.changeDetectorRef.markForCheck();
  }

  selectSituation(situation: 'damaged' | 'not_received'): void {
    this.selectedSituation = situation;
    if (situation === 'damaged') {
      this.pendingReturnReason = this.selectedReturnReason || this.returnReasonsList[1]; // Người bán gửi sai hàng
      this.returnReasonSheetOpen = true;
    } else {
      this.selectedReturnReason = {
        id: 'NOT_RECEIVED_FAKE_STATUS',
        label: 'Chưa nhận hàng hoặc nhận thiếu hàng',
        requiresImage: false,
      };
      this.returnStep = 'form';
    }
    this.changeDetectorRef.markForCheck();
  }

  openReasonSheet(): void {
    this.pendingReturnReason = this.selectedReturnReason || this.returnReasonsList[1];
    this.returnReasonSheetOpen = true;
    this.changeDetectorRef.markForCheck();
  }

  closeReasonSheet(): void {
    this.returnReasonSheetOpen = false;
    this.changeDetectorRef.markForCheck();
  }

  chooseReason(reason: { id: string; label: string; requiresImage?: boolean; requiresVideo?: boolean }): void {
    this.pendingReturnReason = reason;
    this.changeDetectorRef.markForCheck();
  }

  confirmReason(): void {
    if (this.pendingReturnReason) {
      this.selectedReturnReason = this.pendingReturnReason;
      this.returnReasonSheetOpen = false;
      this.returnStep = 'form';
      this.changeDetectorRef.markForCheck();
    }
  }

  onEvidenceFilePicked(event: Event, type: 'image' | 'video'): void {
    const input = event.target as HTMLInputElement;
    if (!input.files || input.files.length === 0) return;
    const file = input.files[0];

    if (type === 'image' && file.size > 20 * 1024 * 1024) {
      this.returnErrorMessage = 'Ảnh không được vượt quá 20MB.';
      return;
    }
    if (type === 'video' && file.size > 200 * 1024 * 1024) {
      this.returnErrorMessage = 'Video không được vượt quá 200MB.';
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      this.returnEvidenceList.push({
        type,
        url: result,
        name: file.name,
      });
      this.changeDetectorRef.markForCheck();
    };
    reader.readAsDataURL(file);
    input.value = '';
  }

  removeEvidence(index: number): void {
    this.returnEvidenceList.splice(index, 1);
    this.changeDetectorRef.markForCheck();
  }

  submitReturnRequest(): void {
    if (!this.returnTargetOrder) return;
    if (!this.selectedReturnReason) {
      this.returnErrorMessage = 'Vui lòng chọn lý do trả hàng/hoàn tiền.';
      return;
    }

    const token = this.getToken();
    if (!token) {
      this.returnErrorMessage = 'Vui lòng đăng nhập lại để tiếp tục.';
      return;
    }

    this.isSubmittingReturn = true;
    this.returnErrorMessage = '';

    let evidencePayload = this.returnEvidenceList.map((e) => ({
      type: e.type,
      url: e.url.length > 1000 ? (this.returnTargetOrder?.items[0]?.image || '/assets/chatbotai.png') : e.url,
    }));
    if (evidencePayload.length === 0) {
      evidencePayload = [{
        type: 'image',
        url: this.returnTargetOrder?.items[0]?.image || '/assets/chatbotai.png',
      }];
    }

    const body = {
      reasonId: this.selectedReturnReason.id,
      note: this.returnDescription.trim() || 'Yêu cầu trả hàng / hoàn tiền cho đơn hàng',
      evidence: evidencePayload,
    };

    const orderId = this.returnTargetOrder.slug;
    this.http.post(`/api/orders/${encodeURIComponent(orderId)}/return-request`, body, {
      headers: this.authorizationHeaders(token),
    }).subscribe({
      next: () => {
        this.isSubmittingReturn = false;
        this.returnSubmitSuccess = true;
        this.changeDetectorRef.markForCheck();
        setTimeout(() => {
          this.closeReturnModal();
          if (this.orderSlug) {
            this.loadOrder(this.orderSlug);
          } else {
            this.loadOrders(this.currentPage, false);
          }
        }, 1500);
      },
      error: (err: unknown) => {
        this.isSubmittingReturn = false;
        if (err instanceof HttpErrorResponse && err.error?.message) {
          this.returnErrorMessage = err.error.message;
        } else {
          this.returnErrorMessage = 'Không thể gửi yêu cầu hoàn trả. Vui lòng thử lại sau.';
        }
        this.changeDetectorRef.markForCheck();
      },
    });
  }

  isStepActive(order: CustomerOrder, step: number): boolean {
    if (order.statusId === 'completed') return true;
    if (order.statusId === 'shipping') return step <= 2;
    if (order.statusId === 'processing') return step <= 1;
    return step <= 1;
  }

  getCarrierName(order: CustomerOrder): string {
    return order.shippingCarrier || order.shippingMethod || 'SPX Express';
  }

  getTrackingCode(order: CustomerOrder): string {
    return order.trackingNumber || `SPXVN${order.slug.replace(/[^0-9]/g, '') || '06742286147A'}`;
  }

  formatTotal(order: CustomerOrder): string {
    if (order.total) return order.total;
    if (order.totalAmount === null) return '';
    return `${new Intl.NumberFormat('vi-VN').format(order.totalAmount)}đ`;
  }

  
  
  loadProvinces(): void {
    if (this.provinces.length > 0) return;
    this.loadingProvinces = true;
    this.addressLookup.getProvinces().subscribe({
      next: (provinces) => {
        this.provinces = provinces;
        this.loadingProvinces = false;
        this.changeDetectorRef.markForCheck();
      },
      error: () => {
        this.loadingProvinces = false;
        this.changeDetectorRef.markForCheck();
      }
    });
  }

  loadSavedAddresses(): void {
    if (!this.isBrowser) return;
    const userId = window.localStorage.getItem('userId')?.trim() || '';
    const storageKey = userId ? `delivery_addresses_${userId}` : 'delivery_addresses_guest';
    const profileAddress = window.localStorage.getItem('userAddress')?.trim() ?? '';
    const addresses: DeliveryAddress[] = [];

    try {
      const saved = window.localStorage.getItem(storageKey);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          for (const item of parsed) {
            if (item && item.id && item.name && item.phone && item.fullAddress) {
              addresses.push({
                id: String(item.id),
                name: String(item.name),
                phone: String(item.phone),
                detail: String(item.detail || ''),
                ward: String(item.ward || ''),
                province: String(item.province || ''),
                fullAddress: String(item.fullAddress),
                isDefault: Boolean(item.isDefault)
              });
            }
          }
        }
      }

      if (profileAddress) {
        const parts = profileAddress.split(',').map((p: string) => p.trim());
        const exists = addresses.some(a => a.fullAddress.toLowerCase() === profileAddress.toLowerCase());
        if (!exists) {
          addresses.unshift({
            id: `profile-${userId || 'user'}`,
            name: window.localStorage.getItem('userName')?.trim() || 'Người nhận',
            phone: window.localStorage.getItem('userPhone')?.trim() || '',
            detail: parts[0] || profileAddress,
            ward: parts.length > 2 ? parts[1] : '',
            province: parts.length > 1 ? parts[parts.length - 1] : '',
            fullAddress: profileAddress,
            isDefault: addresses.length === 0
          });
        }
      }
    } catch (e) {
      console.warn('Lỗi đọc địa chỉ đã lưu:', e);
    }

    this.savedAddresses = addresses;
    const preferred = addresses.find(a => a.isDefault) || addresses[0];
    this.selectedAddressId = preferred?.id || null;
  }

  openChangeAddressModal(order: CustomerOrder, event?: Event): void {
    if (event) {
      event.stopPropagation();
    }
    this.addressTargetOrder = order;
    this.addressModalError = '';
    this.addressSaveSuccess = false;
    this.addAddressFormOpen = false;
    this.loadSavedAddresses();
    this.loadProvinces();

    this.newAddress.name = order.addressName || window.localStorage.getItem('userName') || '';
    this.newAddress.phone = order.addressPhone || window.localStorage.getItem('userPhone') || '';
    this.newAddress.detail = order.addressText || '';

    this.addressModalOpen = true;
    this.changeDetectorRef.markForCheck();
  }

  closeAddressModal(): void {
    this.addressModalOpen = false;
    this.addressTargetOrder = null;
    this.addressModalError = '';
    this.addressSaveSuccess = false;
    this.changeDetectorRef.markForCheck();
  }

  selectSavedAddress(id: string): void {
    this.selectedAddressId = id;
    this.addAddressFormOpen = false;
  }

  toggleAddAddressForm(): void {
    this.addAddressFormOpen = !this.addAddressFormOpen;
    if (this.addAddressFormOpen) {
      this.selectedAddressId = null;
    } else if (this.savedAddresses.length > 0) {
      this.selectedAddressId = this.savedAddresses[0].id;
    }
  }

  onProvinceSelect(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    const code = value ? Number(value) : null;
    this.selectedProvinceCode = code;
    this.selectedWardCode = null;
    this.wards = [];
    if (!code) return;

    this.loadingWards = true;
    this.addressLookup.getWards(code).subscribe({
      next: (wards) => {
        this.wards = wards;
        this.loadingWards = false;
        this.changeDetectorRef.markForCheck();
      },
      error: () => {
        this.loadingWards = false;
        this.changeDetectorRef.markForCheck();
      }
    });
  }

  onWardSelect(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    this.selectedWardCode = value ? Number(value) : null;
  }

  confirmChangeAddress(): void {
    if (!this.addressTargetOrder) return;
    const token = this.getToken();
    if (!token) {
      this.addressModalError = 'Vui lòng đăng nhập để thay đổi địa chỉ.';
      return;
    }

    let recipientName = '';
    let recipientPhone = '';
    let fullAddressText = '';

    if (this.addAddressFormOpen || this.savedAddresses.length === 0) {
      recipientName = this.newAddress.name.trim();
      recipientPhone = this.newAddress.phone.trim();
      const detail = this.newAddress.detail.trim();
      const provinceName = this.provinces.find(p => p.code === this.selectedProvinceCode)?.name || '';
      const wardName = this.wards.find(w => w.code === this.selectedWardCode)?.name || '';

      if (!recipientName) {
        this.addressModalError = 'Vui lòng nhập họ và tên người nhận.';
        return;
      }
      if (!recipientPhone) {
        this.addressModalError = 'Vui lòng nhập số điện thoại người nhận.';
        return;
      }
      if (!detail) {
        this.addressModalError = 'Vui lòng nhập địa chỉ chi tiết.';
        return;
      }

      fullAddressText = [detail, wardName, provinceName].filter(Boolean).join(', ');
    } else {
      const selected = this.savedAddresses.find(a => a.id === this.selectedAddressId);
      if (!selected) {
        this.addressModalError = 'Vui lòng chọn địa chỉ nhận hàng.';
        return;
      }
      recipientName = selected.name;
      recipientPhone = selected.phone;
      fullAddressText = selected.fullAddress;
    }

    this.isSavingAddress = true;
    this.addressModalError = '';

    const payload = {
      name: recipientName,
      phone: recipientPhone,
      address: fullAddressText
    };

    const targetOrder = this.addressTargetOrder;
    this.http.put<{ success: boolean; message: string; address: { name: string; phone: string; address: string } }>(
      `/api/orders/mine/${encodeURIComponent(targetOrder.slug)}/address`,
      payload,
      { headers: this.authorizationHeaders(token) }
    ).subscribe({
      next: (response) => {
        this.isSavingAddress = false;
        this.addressSaveSuccess = true;

        targetOrder.addressName = recipientName;
        targetOrder.addressPhone = recipientPhone;
        targetOrder.addressText = fullAddressText;

        if (this.activeOrder && this.activeOrder.slug === targetOrder.slug) {
          this.activeOrder.addressName = recipientName;
          this.activeOrder.addressPhone = recipientPhone;
          this.activeOrder.addressText = fullAddressText;
        }

        this.ordersCache.clear();

        if (this.addAddressFormOpen && this.isBrowser) {
          const userId = window.localStorage.getItem('userId')?.trim() || '';
          const storageKey = userId ? `delivery_addresses_${userId}` : 'delivery_addresses_guest';
          const newEntry: DeliveryAddress = {
            id: `addr-${Date.now()}`,
            name: recipientName,
            phone: recipientPhone,
            detail: this.newAddress.detail.trim(),
            ward: this.wards.find(w => w.code === this.selectedWardCode)?.name || '',
            province: this.provinces.find(p => p.code === this.selectedProvinceCode)?.name || '',
            fullAddress: fullAddressText,
            isDefault: false
          };
          this.savedAddresses.push(newEntry);
          try {
            window.localStorage.setItem(storageKey, JSON.stringify(this.savedAddresses));
          } catch (e) {}
        }

        setTimeout(() => {
          this.closeAddressModal();
        }, 800);
        this.changeDetectorRef.markForCheck();
      },
      error: (error: unknown) => {
        this.isSavingAddress = false;
        if (error instanceof HttpErrorResponse && error.error?.message) {
          this.addressModalError = error.error.message;
        } else {
          this.addressModalError = 'Không thể cập nhật địa chỉ. Vui lòng thử lại sau.';
        }
        this.changeDetectorRef.markForCheck();
      }
    });
  }

  goToProduct(item: OrderItem, event?: Event): void {
    if (event) {
      event.stopPropagation();
    }
    const target = item.slug || item.productId;
    if (target) {
      void this.router.navigate(['/product-detail', target]);
    }
  }

  backToOrders(): void {
    void this.router.navigate(['/orders']);
  }

  signIn(): void {
    const returnUrl = this.orderSlug ? `/orders/${encodeURIComponent(this.orderSlug)}` : '/orders';
    void this.router.navigate(['/login'], { queryParams: { returnUrl } });
  }

  openReviewModal(order: CustomerOrder, item?: OrderItem): void {
    this.selectedReviewOrder = order;

    // Find eligible matching item if available
    const eligibleMatch = this.eligibleOrders.find(
      (o) => this.isRecord(o) && String(o['id'] ?? o['slug'] ?? o['_id'] ?? '') === order.slug
    );
    const eligibleItemIds = eligibleMatch && Array.isArray(eligibleMatch['items'])
      ? (eligibleMatch['items'] as unknown[]).map((i) => this.isRecord(i) ? String(i['productId'] ?? i['id'] ?? '') : '')
      : [];

    if (item) {
      this.selectedReviewItem = item;
    } else if (eligibleItemIds.length > 0) {
      this.selectedReviewItem =
        order.items.find((i) => i.productId && eligibleItemIds.includes(i.productId)) ||
        order.items[0] ||
        null;
    } else {
      this.selectedReviewItem = order.items[0] || null;
    }

    this.reviewRating = 5;
    this.reviewHoverRating = 0;
    this.reviewContent = '';
    this.reviewErrorMessage = '';
    this.reviewSubmitSuccess = false;
    this.isSubmittingReview = false;
    this.isReviewModalOpen = true;
  }

  closeReviewModal(): void {
    this.isReviewModalOpen = false;
    this.selectedReviewOrder = null;
    this.selectedReviewItem = null;
    this.reviewContent = '';
    this.reviewSubmitSuccess = false;
    this.reviewErrorMessage = '';
  }

  setReviewRating(rating: number): void {
    this.reviewRating = rating;
  }

  setHoverRating(rating: number): void {
    this.reviewHoverRating = rating;
  }

  ratingLabel(rating: number): string {
    switch (rating) {
      case 1: return 'Rất tệ';
      case 2: return 'Không hài lòng';
      case 3: return 'Bình thường';
      case 4: return 'Hài lòng';
      case 5: return 'Tuyệt vời';
      default: return '';
    }
  }

  submitReview(): void {
    if (!this.selectedReviewOrder || !this.selectedReviewItem) return;
    const token = this.getToken();
    if (!token) {
      this.reviewErrorMessage = 'Vui lòng đăng nhập lại để gửi đánh giá.';
      return;
    }

    const productId = this.selectedReviewItem.productId || '';
    if (!productId) {
      this.reviewErrorMessage = 'Không tìm thấy mã sản phẩm cần đánh giá.';
      return;
    }

    this.isSubmittingReview = true;
    this.reviewErrorMessage = '';

    const payload = {
      orderId: this.selectedReviewOrder.slug,
      productId,
      rating: this.reviewRating,
      content: this.reviewContent.trim(),
    };

    this.http.post('/api/reviews', payload, {
      headers: this.authorizationHeaders(token),
    }).subscribe({
      next: () => {
        this.isSubmittingReview = false;
        this.reviewSubmitSuccess = true;
        this.ordersCache.clear();
        this.loadEligibleOrders();
        this.loadOrdersSummary();
        this.changeDetectorRef.markForCheck();
      },
      error: (error: unknown) => {
        this.isSubmittingReview = false;
        if (error instanceof HttpErrorResponse && error.error?.message) {
          this.reviewErrorMessage = error.error.message;
        } else {
          this.reviewErrorMessage = 'Không thể gửi đánh giá. Vui lòng thử lại sau.';
        }
        this.changeDetectorRef.markForCheck();
      },
    });
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
        productId: this.text(item['productId'] ?? item['id'] ?? item['_id']),
        name: this.text(item['name']) || 'Sản phẩm Urii',
        quantity: this.numberOrNull(item['quantity']) || 1,
        unitPrice: this.numberOrNull(item['unitPrice'] ?? item['price']),
        originalPrice: this.numberOrNull(item['originalPrice']),
        image: this.normalizeImage(this.text(item['image'])),
        variantName: this.text(item['variantName']),
        slug: this.text(item['slug'] ?? item['productSlug']),
      });
    }
    const status = this.isRecord(value['status']) ? '' : this.text(value['status']);
    const payment = this.isRecord(value['payment']) ? value['payment'] : {};
    const shipping = this.isRecord(value['shipping']) ? value['shipping'] : {};
    const address = this.isRecord(value['address']) ? value['address'] : {};

    const rawTimeline = Array.isArray(value['timeline']) ? value['timeline'] : [];
    const timeline: OrderTimelineItem[] = rawTimeline
      .filter((t) => this.isRecord(t))
      .map((t) => ({
        statusId: this.text(t['statusId']),
        status: this.text(t['status'] || t['statusId']),
        time: this.text(t['time']),
        note: this.text(t['note']),
      }));

    const rawShippingTimeline = Array.isArray(value['shippingTimeline']) ? value['shippingTimeline'] : [];
    const shippingTimeline: OrderTimelineItem[] = rawShippingTimeline
      .filter((t) => this.isRecord(t))
      .map((t) => ({
        statusId: this.text(t['statusId']),
        status: this.text(t['status'] || t['statusId']),
        location: this.text(t['location']),
        time: this.text(t['time']),
      }));

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
      paymentMethod: this.text(payment['method']) || 'TK Ngân hàng liên kết ShopeePay',
      paymentStatus: this.text(payment['status'] ?? payment['statusId']),
      shippingMethod: this.text(shipping['method'] ?? shipping['methodId']) || 'SPX Express',
      shippingCarrier: this.text(shipping['carrier'] || shipping['method']) || 'SPX Express',
      trackingNumber: this.text(shipping['trackingNumber']),
      shippingFee: this.numberOrNull(shipping['fee']),
      estimatedDelivery: this.text(shipping['estimatedDelivery']),
      timeline,
      shippingTimeline,
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
