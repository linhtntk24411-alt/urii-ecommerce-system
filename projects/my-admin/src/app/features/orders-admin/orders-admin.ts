import { afterNextRender, ChangeDetectorRef, Component, Injector, OnInit, HostListener, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { OnDestroy } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { AdminApiService, AdminUser } from '../../core/services/admin-api.service';
import { AdminSocketService } from '../../core/services/admin-socket.service';
import { combineLatest, Subscription } from 'rxjs';

declare var bootstrap: any;

@Component({
  selector: 'app-orders-admin',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './orders-admin.html',
  styleUrls: ['./orders-admin.css']
})
export class OrdersAdmin implements OnInit, OnDestroy {
  private readonly socket = inject(AdminSocketService);
  constructor(
    private adminApi: AdminApiService,
    private changeDetectorRef: ChangeDetectorRef,
    private route: ActivatedRoute
  ) {}
  // --- THÊM ĐOẠN NÀY ĐỂ FIX LỖI DROPDOWN ---
  activeDropdownId: string | null = null;

  toggleDropdown(id: string, event: Event) {
    event.stopPropagation();
    this.activeDropdownId = this.activeDropdownId === id ? null : id;
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: Event) {
    this.activeDropdownId = null; // Click ra ngoài tự đóng menu
  }
  // ------------------------------------------
  Math = Math;
  // Thêm lại hàm MathMin cho file HTML sử dụng
  MathMin(a: number, b: number) { return Math.min(a, b); }

  // --- Data ---
  originalOrders: any[] = [];
  orders: any[] = [];
  orderLoadError = '';
  private orderDataSubscription?: Subscription;
  private pendingSearchId: string | null = null;
  private readonly injector = inject(Injector);
  private newOrderNavigation = false;
  private orderNavigationVersion = 0;
  private orderListLoading = false;
  private targetLookup?: Subscription;
  private resolvingOrderTarget = false;
  private notificationOrder?: any;
  private orderProducts: any[] = [];
  private restoreOrderHighlight?: () => void;
  orderTargetError = '';
  requestTab: 'cancel' | 'return' = 'cancel';
  returnRequests: any[] = [];
  returnTotal = 0;
  returnPage = 1;
  returnTypeFilter = '';
  returnStatusFilter = '';
  returnOrderTypeFilter = '';
  returnLoading = false;
  returnBusy = false;
  returnDetailLoading = false;
  returnError = '';
  returnSuccess = '';
  selectedReturn: any = null;
  returnAction = '';
  returnDecisionType = '';
  returnActionNote = '';
  returnInspectionResult = 'passed';
  private returnSubscription?: Subscription;
  private returnDetailSubscription?: Subscription;
  private readonly liveSubscriptions = new Subscription();
  readonly returnTypes = [
    { id: 'return_only', label: 'Chỉ trả hàng' }, { id: 'refund_only', label: 'Chỉ hoàn tiền' },
    { id: 'return_and_refund', label: 'Trả hàng và hoàn tiền' }
  ];
  readonly returnStates = [
    { id: 'pending_approval', label: 'Chờ duyệt', badgeClass: 'badge-status-pending_approval' },
    { id: 'approved', label: 'Đã duyệt', badgeClass: 'badge-status-approved' },
    { id: 'awaiting_return_pickup', label: 'Chờ nhận hàng', badgeClass: 'bg-secondary-subtle text-secondary' },
    { id: 'inspecting', label: 'Kiểm tra hàng', badgeClass: 'badge-status-processing' },
    { id: 'refund_pending', label: 'Chờ hoàn tiền', badgeClass: 'badge-status-pending' },
    { id: 'refunded', label: 'Đã hoàn tiền', badgeClass: 'bg-info bg-opacity-10 text-info-emphasis' },
    { id: 'completed', label: 'Hoàn tất', badgeClass: 'badge-status-completed' },
    { id: 'rejected', label: 'Đã từ chối', badgeClass: 'badge-status-cancelled' }
  ];

  getReturnBadgeClass(statusId: string): string {
    return this.returnStates.find(state => state.id === statusId)?.badgeClass || 'bg-secondary-subtle text-secondary';
  }
  readonly returnActionLabels: Record<string, string> = {
    approve: 'Duyệt', reject: 'Từ chối', start: 'Tiếp tục xử lý', receive: 'Xác nhận nhận lại hàng',
    inspect: 'Ghi nhận kiểm hàng', 'prepare-refund': 'Chuyển chờ hoàn tiền',
    'confirm-cod': 'Xác nhận đã nhận thanh toán', 'confirm-refund': 'Xác nhận đã hoàn tiền', complete: 'Hoàn tất yêu cầu', requested: 'Gửi yêu cầu'
  };
  showDeleteConfirm = false;
  deletingOrderId: string | null = null;
  isDeletingOrder = false;
  
  // --- Pagination ---
  currentPage = 1;
  currentCancelPage = 1;
  currentCustomPage = 1;
  ITEMS_PER_PAGE = 4;
  CUSTOM_ITEMS_PER_PAGE = 4;

  // --- Filter ---
  searchQuery: string = '';
  filterStatus: string = '';
  filterDate: string = '';
  filterSort: string = 'newest';
  customSearchQuery: string = '';
  customFilterStatus: string = '';
  customFilterDate: string = '';
  customFilterSort: string = 'newest';
  cancelSearchQuery: string = '';
  cancelFilterDate: string = '';
  cancelFilterSort: string = 'newest';
  returnSearchQuery: string = '';

  // --- Modal Data ---
  selectedOrder: any = null;
  quotePrice: number | null = null;
  quoteDate: string = '';
  quoteNote: string = '';
  quoteAction: 'send' | 'correct' | 'requote' = 'send';
  quoteBusy = false;
  quoteError = '';
  quoteSuccess = '';

  // --- Status Map ---
  statusMap: { [key: string]: any } = {
    "pending": { text: "Chờ xác nhận", class: "badge-status-pending" },
    "approved": { text: "Đã xác nhận", class: "badge-status-approved" },
    "quoted": { text: "Đã báo giá", class: "bg-primary bg-opacity-10 text-primary" },
    "completed": { text: "Hoàn thành", class: "badge-status-completed" },
    "cancelled": { text: "Đã hủy", class: "badge-status-cancelled" },
    "pending_approval": { text: "Chờ duyệt", class: "badge-status-pending_approval" },
    "waiting_quote": { text: "Chờ báo giá", class: "badge-status-waiting_quote" },
    "processing": { text: "Đang gia công", class: "badge-status-processing" },
    "shipping": { text: "Đang giao", class: "bg-info bg-opacity-10 text-info-emphasis" },
    "returned": { text: "Trả hàng", class: "bg-secondary-subtle text-secondary" },
    "return_requested": { text: "Chờ xử lý hoàn trả", class: "bg-danger text-white" }
  };

  getOrderBadgeClass(order: any): string {
    if (order?.returnStatusId === 'pending_approval') return 'bg-primary bg-opacity-10 text-primary';

    return order?.returnStatusId
      ? this.getReturnBadgeClass(order.returnStatusId)
      : this.statusMap[order?.status]?.class || '';
  }

  getStatusLabel(order: any): string {
    if (order?.returnStatusId) return `Hoàn trả: ${this.returnStates.find(state => state.id === order.returnStatusId)?.label || order.returnStatusId}`;
    if (order?.status === 'processing' && !order.isCustomOrder) return 'Chờ lấy hàng';
    return this.statusMap[order?.status]?.text || order?.status || '';
  }

  ngOnInit(): void {
    this.orderListLoading = true;
    this.liveSubscriptions.add(this.route.queryParamMap.subscribe(params => {
      ++this.orderNavigationVersion;
      this.targetLookup?.unsubscribe();
      this.resolvingOrderTarget = false;
      this.orderTargetError = '';
      this.newOrderNavigation = params.has('notificationClick');
      this.pendingSearchId = params.get('searchType') === 'order'
        ? params.get('searchId')
        : null;
      if (!this.newOrderNavigation || !this.pendingSearchId ||
          (this.notificationOrder?.id !== this.pendingSearchId && String(this.notificationOrder?._id) !== this.pendingSearchId)) {
        this.notificationOrder = undefined;
      }
      this.applySearchTarget();
      if (this.pendingSearchId && !this.newOrderNavigation) this.locateReturnRequest(this.pendingSearchId);
    }));
    this.loadCustomerAvatars();
    this.loadOrders();
    this.loadReturnRequests();
    this.liveSubscriptions.add(this.socket.onCrudChange('orders').subscribe(() => this.loadOrders()));
    this.liveSubscriptions.add(this.socket.onCrudChange('customOrders').subscribe(() => this.loadOrders()));
    this.liveSubscriptions.add(this.socket.onCrudChange('orders').subscribe(() => this.loadReturnRequests()));
    this.liveSubscriptions.add(this.socket.onCrudChange('customOrders').subscribe(() => this.loadReturnRequests()));
  }

  ngOnDestroy(): void {
    this.liveSubscriptions.unsubscribe();
    this.orderDataSubscription?.unsubscribe();
    this.targetLookup?.unsubscribe();
    this.restoreOrderHighlight?.();
    this.returnSubscription?.unsubscribe();
    this.returnDetailSubscription?.unsubscribe();
  }

  searchTargetId(id: string | number): string {
    return `admin-search-target-order-${encodeURIComponent(String(id))}`;
  }

  private applySearchTarget(): void {
    const searchId = this.pendingSearchId;
    if (!searchId || this.resolvingOrderTarget) return;

    const order = this.originalOrders.find(item => String(item.id) === searchId
      || (this.newOrderNavigation && String(item._id) === searchId));
    if (!order) {
      if (this.newOrderNavigation && !this.orderListLoading) this.loadOrderSearchTarget(searchId);
      return;
    }
    const id = String(order.id);
    if (order.returnStatusId && !this.newOrderNavigation) {
      this.pendingSearchId = null;
      this.locateReturnRequest(id);
      return;
    }

    this.searchQuery = '';
    this.filterStatus = '';
    this.filterDate = '';
    this.filterSort = 'newest';
    this.customSearchQuery = '';
    this.customFilterStatus = '';
    this.customFilterDate = '';
    this.customFilterSort = 'newest';
    this.applyFilters();

    if (order.isCustomOrder) {
      const index = this.customOrders.findIndex(item => String(item.id) === id);
      this.currentCustomPage = Math.floor(index / this.CUSTOM_ITEMS_PER_PAGE) + 1;
    } else if (order.status === 'pending_approval') {
      const index = this.cancelRequests.findIndex(item => String(item.id) === id);
      this.currentCancelPage = Math.floor(index / this.ITEMS_PER_PAGE) + 1;
    } else {
      const index = this.regularOrders.findIndex(item => String(item.id) === id);
      this.currentPage = Math.floor(index / this.ITEMS_PER_PAGE) + 1;
    }

    if (!this.newOrderNavigation) {
      this.pendingSearchId = null;
      this.scrollToSearchTarget(this.searchTargetId(id));
      return;
    }

    this.resolvingOrderTarget = true;
    const version = this.orderNavigationVersion;
    afterNextRender(() => {
      if (version !== this.orderNavigationVersion) return;
      const row = document.getElementById(this.searchTargetId(id));
      if (row instanceof HTMLTableRowElement) this.highlightOrderRow(row);
      this.finishOrderTarget(row instanceof HTMLTableRowElement ? '' : 'Không thể định vị đơn hàng trên bảng. Vui lòng thử lại.');
    }, { injector: this.injector });
    this.changeDetectorRef.markForCheck();
  }

  private loadOrderSearchTarget(id: string): void {
    this.resolvingOrderTarget = true;
    const version = this.orderNavigationVersion;
    this.targetLookup = this.adminApi.getOrderById(id).subscribe({
      next: item => {
        if (version !== this.orderNavigationVersion) return;
        if (!item || (String(item.id) !== id && String(item._id) !== id)) {
          this.finishOrderTarget('Máy chủ trả về đơn hàng không khớp với thông báo.');
          return;
        }
        const order = this.normalizeRegularOrder(item, this.orderProducts);
        this.notificationOrder = order;
        if (!this.originalOrders.some(current => current.id === order.id)) this.originalOrders = [...this.originalOrders, order];
        this.resolvingOrderTarget = false;
        this.applySearchTarget();
      },
      error: (error: unknown) => {
        if (version !== this.orderNavigationVersion) return;
        this.finishOrderTarget(error instanceof HttpErrorResponse && error.status === 404
          ? 'Đơn hàng không còn tồn tại hoặc đã bị xóa.' : 'Không thể tải đơn hàng từ thông báo. Vui lòng thử lại.');
      }
    });
  }

  private finishOrderTarget(error: string): void {
    this.pendingSearchId = null;
    this.resolvingOrderTarget = false;
    this.orderTargetError = error;
    this.changeDetectorRef.markForCheck();
  }

  private scrollToSearchTarget(elementId: string): void {
    if (typeof document === 'undefined' || typeof requestAnimationFrame === 'undefined') return;
    requestAnimationFrame(() => {
      const row = document.getElementById(elementId);
      if (row instanceof HTMLTableRowElement) this.highlightOrderRow(row);
    });
  }

  private highlightOrderRow(row: HTMLTableRowElement): void {
    this.restoreOrderHighlight?.();
    row.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const cells = Array.from(row.cells);
    const originalStyles = cells.map(cell => ({
      backgroundColor: cell.style.getPropertyValue('background-color'),
      backgroundPriority: cell.style.getPropertyPriority('background-color')
    }));

    cells.forEach(cell => {
      cell.style.setProperty('background-color', '#fffbea', 'important');
    });

    const timer = window.setTimeout(() => this.restoreOrderHighlight?.(), 3000);
    this.restoreOrderHighlight = () => {
      window.clearTimeout(timer);
      this.restoreOrderHighlight = undefined;
      cells.forEach((cell, index) => {
        const original = originalStyles[index];
        if (original.backgroundColor) {
          cell.style.setProperty('background-color', original.backgroundColor, original.backgroundPriority);
        } else {
          cell.style.removeProperty('background-color');
        }
      });
    };
  }

  // --- Computed Lists ---
  get regularOrders() { return this.orders.filter(o => o.status !== 'pending_approval' && !o.isCustomOrder); }
  get pagedRegularOrders() {
    const start = (this.currentPage - 1) * this.ITEMS_PER_PAGE;
    return this.regularOrders.slice(start, start + this.ITEMS_PER_PAGE);
  }

  get cancelRequests() {
    const search = this.cancelSearchQuery.toLowerCase().trim();
    const list = this.orders.filter(o => {
      if (o.status !== 'pending_approval') return false;
      const matchSearch = !search ||
        String(o.id || '').toLowerCase().includes(search) ||
        String(o.customerName || '').toLowerCase().includes(search) ||
        String(o.reason || '').toLowerCase().includes(search) ||
        String(o.cancellationNote || '').toLowerCase().includes(search);
      let matchDate = true;
      if (this.cancelFilterDate) {
        const parts = this.cancelFilterDate.split('-');
        const expectedDate = `${parts[2]}/${parts[1]}/${parts[0]}`;
        const unpaddedDate = `${Number(parts[2])}/${Number(parts[1])}/${parts[0]}`;
        const targetDate = o.cancellationDate || o.date || '';
        matchDate = targetDate === expectedDate || targetDate === unpaddedDate;
      }
      return matchSearch && matchDate;
    });
    return this.sortOrdersByDate(list, 'cancellationRequestedAt', this.cancelFilterSort === 'oldest');
  }
  get pagedCancelRequests() {
    const start = (this.currentCancelPage - 1) * this.ITEMS_PER_PAGE;
    return this.cancelRequests.slice(start, start + this.ITEMS_PER_PAGE);
  }

  get filteredReturnRequests() {
    const search = this.returnSearchQuery.toLowerCase().trim();
    if (!search) return this.returnRequests;
    return this.returnRequests.filter(r =>
      String(r.id || '').toLowerCase().includes(search) ||
      String(r.customerName || '').toLowerCase().includes(search) ||
      String(r.returnReason || '').toLowerCase().includes(search) ||
      String(r.requestTypeLabel || '').toLowerCase().includes(search) ||
      String(r.orderTypeLabel || '').toLowerCase().includes(search) ||
      String(r.returnStatusLabel || '').toLowerCase().includes(search)
    );
  }

  applyCancelFilters(): void {
    this.currentCancelPage = 1;
  }

  applyReturnFilters(): void {
    this.loadReturnRequests(1);
  }

  get customOrders() { return this.orders.filter(o => o.isCustomOrder === true); }
  get pagedCustomOrders() {
    const start = (this.currentCustomPage - 1) * this.CUSTOM_ITEMS_PER_PAGE;
    return this.customOrders.slice(start, start + this.CUSTOM_ITEMS_PER_PAGE);
  }

  // --- Stats ---
  get statTotal() { return this.orders.length; }
  get statPending() { return this.orders.filter(o => o.status === 'pending').length; }
  get statApproved() { return this.orders.filter(o => o.status === 'approved').length; }
  get statCancel() { return this.orders.filter(o => o.status === 'pending_approval').length; }

  // --- Logic Load Data ---
 loadOrders() {
    this.orderLoadError = '';
    this.orderListLoading = true;
    this.orderDataSubscription?.unsubscribe();
    this.orderDataSubscription = combineLatest({
      response: this.adminApi.getOrders(true),
      customResponse: this.adminApi.getCustomOrders(true),
      products: this.adminApi.products$
    }).subscribe({
      next: ({ response, customResponse, products }) => {
        this.orderListLoading = false;
        this.orderProducts = products;
        const orderList = Array.isArray(response)
          ? response
          : Array.isArray(response?.orders)
            ? response.orders
            : null;
        if (!orderList) {
          console.error('API đơn hàng trả về dữ liệu không hợp lệ:', response);
          this.applySearchTarget();
          return;
        }

        const customOrderList = Array.isArray(customResponse)
          ? customResponse
          : Array.isArray(customResponse?.customOrders)
            ? customResponse.customOrders
            : null;
        if (!customOrderList) {
          this.orderLoadError = 'Máy chủ trả về danh sách đơn hàng custom không hợp lệ.';
          console.error('API đơn hàng custom trả về dữ liệu không hợp lệ:', customResponse);
          this.applySearchTarget();
          return;
        }

        const regularOrders = orderList.map((item: any) => this.normalizeRegularOrder(item, products));

        if (this.notificationOrder && !regularOrders.some((item: any) => item.id === this.notificationOrder.id)) {
          regularOrders.push(this.notificationOrder);
        }
        this.originalOrders = [
          ...regularOrders,
          ...customOrderList.map((item: any) => this.normalizeCustomOrder(item))
        ];
        if (!this.resolvingOrderTarget || !this.newOrderNavigation) {
          this.applyFilters(false);
          this.currentPage = Math.min(this.currentPage, Math.max(1, Math.ceil(this.regularOrders.length / this.ITEMS_PER_PAGE)));
          this.currentCancelPage = Math.min(this.currentCancelPage, Math.max(1, Math.ceil(this.cancelRequests.length / this.ITEMS_PER_PAGE)));
          this.currentCustomPage = Math.min(this.currentCustomPage, Math.max(1, Math.ceil(this.customOrders.length / this.CUSTOM_ITEMS_PER_PAGE)));
        }
        if (this.selectedOrder?.isCustomOrder && typeof document !== 'undefined' && document.getElementById('customFormModal')?.classList.contains('show')) {
          const latest = this.originalOrders.find(item => item.isCustomOrder && item.id === this.selectedOrder.id);
          if (latest) this.selectedOrder = latest;
        }
        this.applySearchTarget();
        this.changeDetectorRef.markForCheck();
      },
      error: (err: any) => {
        this.orderListLoading = false;
        console.error('Lỗi tải đơn hàng:', err);
        this.orderLoadError = err.status === 401 || err.status === 403
          ? 'Phiên đăng nhập không hợp lệ hoặc đã hết hạn. Vui lòng đăng nhập lại để xem đơn hàng.'
          : 'Không thể tải đơn hàng. Vui lòng thử lại sau.';
        if (!this.newOrderNavigation) {
          this.originalOrders = [];
          this.orders = [];
        }
        this.applySearchTarget();
        this.changeDetectorRef.markForCheck();
      }
    });
  }

  private normalizeRegularOrder(item: any, products: any[]): any {
    const orderItems = Array.isArray(item.items)
      ? item.items.map((orderItem: any) => this.normalizeOrderItem(orderItem, products))
      : [];
    const name = item.userName || item.address?.name || 'Khách hàng';
    const customerImage = item.customerImage
      || item.userAvatar
      || this.customerAvatars.get(this.normalizeCustomerName(name))
      || 'images/avatar-non.jpg';

    const rawStatus = String(item.statusType || item.status || '')
      .trim()
      .toLowerCase();
    const rawCancellationStatus = String(
      item.cancellationStatusId || item.cancellationStatus || ''
    ).trim().toLowerCase();

    const statusAliases: { [key: string]: string } = {
      'pending': 'pending',
      'chờ xác nhận': 'pending',
      'approved': 'approved',
      'đã xác nhận': 'approved',
      'completed': 'completed',
      'hoàn thành': 'completed',
      'cancelled': 'cancelled',
      'canceled': 'cancelled',
      'đã hủy': 'cancelled',
      'quoted': 'approved',
      'đã báo giá': 'approved',
      'pending_approval': 'pending_approval',
      'chờ duyệt': 'pending_approval',
      'waiting_quote': 'waiting_quote',
      'chờ báo giá': 'waiting_quote',
      'processing': 'processing',
      'đang gia công': 'processing',
      'chờ lấy hàng': 'processing',
      'shipping': 'shipping',
      'đang giao': 'shipping',
      'chờ giao hàng': 'shipping',
      'đã giao': 'completed',
      'returned': 'returned',
      'trả hàng': 'returned',
      'return_requested': 'return_requested'
    };
    const cancellationStatusAliases: { [key: string]: string } = {
      pending_approval: 'pending_approval',
      'chờ duyệt': 'pending_approval',
      'chờ shop xác nhận': 'pending_approval',
      approved: 'approved',
      rejected: 'rejected'
    };
    const cancellationStatus =
      cancellationStatusAliases[rawCancellationStatus] || rawCancellationStatus;
    const cancellationRequestDate = item.cancellationRequestedAt
      ? new Date(item.cancellationRequestedAt)
      : null;

    return {
      ...item,
      id: String(item.id || item._id || ''),
      customerName: name,
      customerImage,
      customerAvatar: name.length >= 2
        ? name.substring(0, 2).toUpperCase()
        : 'KH',
      phone: item.phone || item.address?.phone || '',
      address: item.address?.address || item.address || '',
      total: this.getOrderTotal(item, orderItems),
      items: orderItems,
      product: item.product || orderItems.map((orderItem: any) =>
        `${orderItem.name}${orderItem.variantName ? ` - ${orderItem.variantName}` : ''} (x${orderItem.quantity ?? 1})`
      ).join(', ') || '',
      reason: item.cancellationReason || item.reason || '',
      cancellationNote: item.cancellationNote || '',
      cancellationDate: cancellationRequestDate && !Number.isNaN(cancellationRequestDate.getTime())
        ? cancellationRequestDate.toLocaleDateString('vi-VN')
        : '',
      date: item.date || '',
      status: cancellationStatus === 'pending_approval'
        ? 'pending_approval'
        : statusAliases[rawStatus] || 'pending'
    };
  }

  private normalizeOrderItem(orderItem: any, products: any[]): any {
    const product = products.find(
      (candidate: any) => String(candidate.id) === String(orderItem.productId)
    );
    const variant = Number.isInteger(orderItem.variantIndex)
      ? product?.variants?.[orderItem.variantIndex]
      : undefined;

    return {
      ...orderItem,
      name: orderItem.name || orderItem.productName || product?.name || `Sản phẩm #${orderItem.productId || ''}`,
      price: orderItem.price ?? orderItem.unitPrice ?? variant?.price ?? 0,
      image: orderItem.image || variant?.image || product?.image || '',
      variantName: orderItem.variantName || variant?.name || ''
    };
  }

  private getOrderTotal(order: any, items: any[]): number {
    const totalValues = [
      order.totalAmount,
      order.total,
      order.pricing?.finalTotal
    ];

    for (const value of totalValues) {
      if (value === null || value === undefined || value === '') continue;
      const amount = typeof value === 'number'
        ? value
        : Number(String(value).replace(/[^0-9]/g, ''));
      if (Number.isFinite(amount) && amount >= 0) return amount;
    }

    return items.reduce((sum, item) => {
      const price = Number(item.price) || 0;
      const quantity = Number(item.quantity) || 0;
      return sum + price * quantity;
    }, 0);
  }

  private normalizeCustomOrder(item: any): any {
    const rawStatus = String(item.status || '').trim().toLowerCase();
    const statusAliases: { [key: string]: string } = {
      pending: 'waiting_quote',
      quoted: 'quoted',
      processing: 'processing',
      completed: 'completed',
      cancelled: 'cancelled'
    };
    const createdAt = item.createdAt ? new Date(item.createdAt) : null;
    const date = createdAt && !Number.isNaN(createdAt.getTime())
      ? createdAt.toLocaleDateString('vi-VN')
      : '';

    const rawId = String(item.id || item._id || '');
    const uuidMatch = rawId.match(/^(?:custom|customer)-order-([0-9a-f]{8})-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    const normalizedId = uuidMatch
      ? `customer-order-URII-${(parseInt(uuidMatch[1], 16) % 9000) + 1000}`
      : rawId;

    return {
      ...item,
      id: normalizedId,
      isCustomOrder: true,
      customerName: item.fullName || 'Khách hàng',
      customerImage: this.customerAvatars.get(
        this.normalizeCustomerName(item.fullName || '')
      ) || 'images/avatar-non.jpg',
      phone: item.phone || '',
      email: item.email || '',
      date,
      product: item.requestName || 'Yêu cầu thiết kế custom',
      customDetails: Object.fromEntries(Object.entries({
        'Tên mẫu yêu cầu': item.requestName || '',
        'Kích thước': item.size || '',
        'Loại hạt': item.beadType || '',
        'Mã mẫu tham khảo': item.mapId || ''
      }).filter(([, value]) => Boolean(value))),
      customerNote: item.description || '',
      status: statusAliases[rawStatus] || 'waiting_quote'
    };
  }

  private customerAvatars = new Map<string, string>();

  private loadCustomerAvatars(): void {
    this.setCustomerAvatars(this.adminApi.getInitialUsers());
    this.adminApi.getUsers()
      .then(users => this.setCustomerAvatars(users))
      .catch(error => console.error('Lỗi tải ảnh đại diện khách hàng:', error));
  }

  private setCustomerAvatars(users: AdminUser[]): void {
    this.customerAvatars = new Map(
      users
        .filter(user => user.avatar)
        .map(user => [this.normalizeCustomerName(user.name), user.avatar as string])
    );

    const applyAvatar = (order: any) => ({
      ...order,
      customerImage: this.customerAvatars.get(this.normalizeCustomerName(order.customerName))
        || order.customerImage
        || 'images/avatar-non.jpg'
    });

    this.originalOrders = this.originalOrders.map(applyAvatar);
    this.orders = this.orders.map(applyAvatar);
    this.changeDetectorRef.markForCheck();
  }

  private normalizeCustomerName(name: string): string {
    return name.trim().replace(/\s+/g, ' ').toLocaleLowerCase();
  }

  getCustomerAvatarUrl(imagePath?: string): string {
    const path = imagePath || 'images/avatar-non.jpg';
    if (path.startsWith('http://') || path.startsWith('https://') || path.startsWith('data:')) {
      return path;
    }
    return this.adminApi.getLibraryMapImageUrl(path);
  }

  onCustomerAvatarError(event: Event): void {
    const image = event.target as HTMLImageElement;
    const fallbackUrl = this.getCustomerAvatarUrl('images/avatar-non.jpg');
    if (image.src !== fallbackUrl) {
      image.src = fallbackUrl;
    }
  }

  saveOrders() {
    if (typeof window !== 'undefined' && typeof localStorage !== 'undefined') {
      localStorage.setItem('orders', JSON.stringify(this.originalOrders));
    }
    this.applyFilters();
  }

  // --- Utilities ---
  objectKeys(obj: any) { return obj ? Object.keys(obj) : []; }
  
  getPageArray(totalItems: number, itemsPerPage: number): number[] {
    const totalPages = Math.ceil(totalItems / itemsPerPage) || 1;
    return Array.from({ length: totalPages }, (_, i) => i + 1);
  }

  private sortOrdersByDate<T extends { id?: string; _id?: string; createdAt?: string; cancellationRequestedAt?: string }>(
    orders: T[], field: 'createdAt' | 'cancellationRequestedAt', oldest: boolean
  ): T[] {
    const direction = oldest ? 1 : -1;
    const timestamp = (value: unknown) => typeof value === 'string' ? Date.parse(value) || 0 : 0;
    return orders.sort((a, b) => direction * (timestamp(a[field]) - timestamp(b[field])
      || String(a._id || a.id || '').localeCompare(String(b._id || b.id || ''))));
  }

  // --- Filter ---
  applyFilters(resetPage = true) {
    const search = this.searchQuery.toLowerCase().trim();
    const filteredRegular = this.originalOrders.filter(o => {
      if (o.isCustomOrder || o.status === 'pending_approval') return false;
      const productNames = Array.isArray(o.items)
        ? o.items.map((item: any) => item.name || '').join(' ')
        : '';
      const matchSearch =
        String(o.id || '').toLowerCase().includes(search) ||
        String(o.customerName || '').toLowerCase().includes(search) ||
        String(o.product || '').toLowerCase().includes(search) ||
        productNames.toLowerCase().includes(search);
      const matchStatus = this.filterStatus === '' || o.status === this.filterStatus;
      let matchDate = true;
      if (this.filterDate) {
        const parts = this.filterDate.split('-');
        matchDate = o.date === `${parts[2]}/${parts[1]}/${parts[0]}`;
      }
      return matchSearch && matchStatus && matchDate;
    });

    this.sortOrdersByDate(filteredRegular, 'createdAt', this.filterSort === 'oldest');

    const custom = this.filterCustomOrdersList();
    const cancel = this.originalOrders.filter(o => o.status === 'pending_approval');
    
    this.orders = [...filteredRegular, ...custom, ...cancel];
    if (resetPage) this.currentPage = 1;
  }

  private filterCustomOrdersList(): any[] {
    const search = this.customSearchQuery.toLowerCase().trim();
    const filteredCustom = this.originalOrders.filter(o => {
      if (!o.isCustomOrder) return false;
      const detailsText = o.customDetails ? Object.values(o.customDetails).join(' ') : '';
      const matchSearch = !search ||
        String(o.id || '').toLowerCase().includes(search) ||
        String(o.customerName || '').toLowerCase().includes(search) ||
        String(o.product || '').toLowerCase().includes(search) ||
        String(o.phone || '').toLowerCase().includes(search) ||
        String(o.email || '').toLowerCase().includes(search) ||
        detailsText.toLowerCase().includes(search);
      const matchStatus = this.customFilterStatus === '' || o.status === this.customFilterStatus;
      let matchDate = true;
      if (this.customFilterDate) {
        const parts = this.customFilterDate.split('-');
        const expectedViDate = `${parts[2]}/${parts[1]}/${parts[0]}`;
        const unpaddedViDate = `${Number(parts[2])}/${Number(parts[1])}/${parts[0]}`;
        const rawCreatedDate = o.createdAt ? new Date(o.createdAt).toISOString().slice(0, 10) : '';
        matchDate = o.date === expectedViDate || o.date === unpaddedViDate || rawCreatedDate === this.customFilterDate;
      }
      return matchSearch && matchStatus && matchDate;
    });

    return this.sortOrdersByDate(filteredCustom, 'createdAt', this.customFilterSort === 'oldest');
  }

  applyCustomFilters(): void {
    const regular = this.orders.filter(o => o.status !== 'pending_approval' && !o.isCustomOrder);
    const custom = this.filterCustomOrdersList();
    const cancel = this.originalOrders.filter(o => o.status === 'pending_approval');
    this.orders = [...regular, ...custom, ...cancel];
    this.currentCustomPage = 1;
  }

  // --- Actions ---
  alertPendingDeliveryError(): void {
    alert('Đơn hàng đang chờ xác nhận không được giao hàng. Vui lòng xác nhận đơn hàng trước khi tiến hành chuẩn bị và giao.');
  }

  updateOrderStatus(id: string, newStatus: string) {
    const order = this.originalOrders.find(o => String(o.id) === String(id));
    if (order && (order.status === 'pending' || order.statusId === 'pending') && (newStatus === 'completed' || newStatus === 'shipping')) {
      this.alertPendingDeliveryError();
      this.activeDropdownId = null;
      return;
    }
    const statusPayloadMap: Record<string, { statusId: string; status: string; statusType: string }> = {
    pending: { statusId: 'pending', status: 'Chờ xác nhận', statusType: 'pending' },
    approved: { statusId: 'processing', status: 'Đã xác nhận', statusType: 'approved' },
    completed: { statusId: 'completed', status: 'Đã giao', statusType: 'completed' },
    cancelled: { statusId: 'cancelled', status: 'Đã hủy', statusType: 'cancelled' }
  };
  const payload = statusPayloadMap[newStatus] || { statusType: newStatus };
  this.adminApi.updateOrder(id, payload).subscribe({
    next: () => {
      const order = this.originalOrders.find(o => o.id === id);
      if (order) {
        order.status = newStatus;
        this.saveOrders();
      }
      this.activeDropdownId = null;
    },
    error: (err) => {
      console.error('Lỗi cập nhật trạng thái:', err);
      alert('Không thể cập nhật trạng thái đơn hàng!');
    }
  });
 }

  deleteOrder(id: string) {
    this.deletingOrderId = id;
    this.showDeleteConfirm = true;
  }

  closeDeleteConfirm(): void {
    if (this.isDeletingOrder) return;
    this.showDeleteConfirm = false;
    this.deletingOrderId = null;
  }

  confirmDeleteOrder(): void {
    const id = this.deletingOrderId;
    if (!id || this.isDeletingOrder) return;

    this.isDeletingOrder = true;
    this.adminApi.deleteOrder(id).subscribe({
      next: () => {
        this.originalOrders = this.originalOrders.filter(o => o.id !== id);
        this.saveOrders();
        this.showDeleteConfirm = false;
        this.deletingOrderId = null;
        this.isDeletingOrder = false;
        alert('Đã xóa đơn hàng!');
      },
      error: (err) => {
        console.error('Lỗi xóa đơn hàng:', err);
        this.isDeletingOrder = false;
        alert('Không thể xóa đơn hàng!');
      }
    });
  }

  handleCancelRequest(id: string, isApproved: boolean): void {
    const order = this.originalOrders.find(o => o.id === id);

    if (!order) {
      alert('Không tìm thấy đơn hàng!');
      return;
    }

    const newStatus = isApproved ? 'cancelled' : 'pending';

    const confirmMessage = isApproved
      ? `Bạn có chắc chắn muốn duyệt hủy đơn hàng #${id}?`
      : `Bạn có chắc chắn muốn từ chối yêu cầu hủy đơn #${id}?`;

    if (!confirm(confirmMessage)) return;

    this.adminApi.updateOrder(id, {
      statusType: newStatus,
      cancellationStatusId: isApproved ? 'approved' : 'rejected'
    }).subscribe({
      next: () => {
        order.status = newStatus;
        order.cancellationStatusId = isApproved ? 'approved' : 'rejected';
        this.saveOrders();

        alert(
          isApproved
            ? 'Đã duyệt yêu cầu hủy đơn hàng!'
            : 'Đã từ chối yêu cầu hủy đơn hàng!'
        );
      },
      error: (err) => {
        console.error('Lỗi xử lý yêu cầu hủy đơn:', err);
        alert('Không thể cập nhật yêu cầu hủy đơn. Vui lòng thử lại!');
      }
    });
  }

  // --- Modals Logic ---
  loadReturnRequests(page = this.returnPage): void {
    this.returnSubscription?.unsubscribe();
    this.returnLoading = true;
    this.returnError = '';
    this.returnSubscription = this.adminApi.getReturnRequests({ page, limit: this.ITEMS_PER_PAGE,
      requestType: this.returnTypeFilter, status: this.returnStatusFilter, orderType: this.returnOrderTypeFilter }).subscribe({
      next: response => {
        this.returnRequests = response.requests || [];
        this.returnTotal = response.total || 0;
        this.returnPage = response.page || 1;
        this.returnLoading = false;
        const lastPage = Math.max(1, Math.ceil(this.returnTotal / this.ITEMS_PER_PAGE));
        if (!this.returnRequests.length && this.returnPage > lastPage && page !== lastPage) {
          this.loadReturnRequests(lastPage);
          return;
        }
        this.changeDetectorRef.markForCheck();
      },
      error: error => {
        this.returnLoading = false;
        this.returnError = error.error?.message || 'Không tải được yêu cầu hoàn trả. Vui lòng thử lại.';
        this.changeDetectorRef.markForCheck();
      }
    });
  }

  private locateReturnRequest(id: string): void {
    this.adminApi.getReturnRequests({ orderId: id, limit: 2 }).subscribe({
      next: response => {
        if (response.requests?.length) {
          this.requestTab = 'return';
          this.openReturnDetail(response.requests[0]);
          this.changeDetectorRef.markForCheck();
        }
      }, error: () => { /* List remains available for manual lookup. */ }
    });
  }

  openReturnDetail(request: any): void {
    if (this.returnBusy) return;
    this.returnDetailLoading = true;
    if (this.selectedReturn?.id !== request.id || this.selectedReturn?.source !== request.source) this.selectedReturn = null;
    this.returnAction = '';
    this.returnError = '';
    this.returnSuccess = '';
    this.returnDetailSubscription?.unsubscribe();
    this.returnDetailSubscription = this.adminApi.getReturnRequest(request.source, request.id).subscribe({
      next: detail => {
        this.returnDetailLoading = false;
        this.selectedReturn = detail;
        bootstrap.Modal.getOrCreateInstance(document.getElementById('returnRequestModal')).show();
        this.changeDetectorRef.markForCheck();
      }, error: error => {
        this.returnDetailLoading = false;
        this.returnError = error.error?.message || 'Không tải được chi tiết yêu cầu.';
        this.changeDetectorRef.markForCheck();
      }
    });
  }

  beginReturnAction(action: string): void {
    if (this.returnBusy || !this.selectedReturn?.availableActions?.includes(action)) return;
    this.returnAction = action;
    this.returnDecisionType = this.isReturnType(this.selectedReturn.requestType) ? this.selectedReturn.requestType : '';
    this.returnActionNote = '';
    this.returnInspectionResult = 'passed';
    this.returnError = '';
    this.returnSuccess = '';
  }

  submitReturnAction(): void {
    if (this.returnBusy || !this.selectedReturn || !this.returnAction) return;
    if (this.returnAction === 'approve' && !this.returnTypes.some(type => type.id === this.returnDecisionType)) {
      this.returnError = 'Vui lòng chọn loại xử lý.'; return;
    }
    if (this.returnAction === 'reject' && !this.returnActionNote.trim()) {
      this.returnError = 'Bắt buộc nhập lý do từ chối.'; return;
    }
    if (!confirm(`Xác nhận: ${this.returnActionLabels[this.returnAction]}?`)) return;
    this.returnBusy = true;
    this.adminApi.processReturnRequest(this.selectedReturn.source, this.selectedReturn.id, this.returnAction, {
      revision: this.selectedReturn.returnRevision || 0, requestType: this.returnDecisionType,
      note: this.returnActionNote.trim(), result: this.returnInspectionResult
    }).subscribe({
      next: detail => {
        this.selectedReturn = detail;
        this.returnAction = '';
        this.returnBusy = false;
        this.returnError = '';
        this.returnSuccess = 'Đã lưu xử lý yêu cầu.';
        this.loadReturnRequests();
        this.loadOrders();
        this.changeDetectorRef.markForCheck();
      }, error: error => {
        this.returnBusy = false;
        this.returnError = error.error?.message || 'Không thể xử lý yêu cầu. Vui lòng tải lại chi tiết.';
        this.returnAction = '';
        this.selectedReturn = { ...this.selectedReturn, availableActions: [] };
        this.changeDetectorRef.markForCheck();
      }
    });
  }

  isReturnType(type: string): boolean {
    return this.returnTypes.some(item => item.id === type);
  }

  getReturnOrderTotal(order: any): number {
    if (!order) return 0;
    const matchedOrder = this.originalOrders.find(o => String(o.id) === String(order.id));
    const candidates = [
      order.totalAmount,
      order.total,
      order.pricing?.finalTotal,
      order.quotedPrice,
      order.returnRefund?.amount,
      order.returnCod?.amount,
      order.codAmount,
      matchedOrder?.totalAmount,
      matchedOrder?.total,
      matchedOrder?.quotedPrice
    ];
    for (const value of candidates) {
      if (value === null || value === undefined || value === '') continue;
      const amount = typeof value === 'number'
        ? value
        : Number(String(value).replace(/[^0-9]/g, ''));
      if (Number.isFinite(amount) && amount > 0) return amount;
    }
    const items = Array.isArray(order.items) && order.items.length
      ? order.items
      : (Array.isArray(matchedOrder?.items) ? matchedOrder.items : []);
    return items.reduce((sum: number, item: any) => {
      const price = Number(item.unitPrice ?? item.price) || 0;
      const quantity = Number(item.quantity) || 1;
      return sum + price * quantity;
    }, 0);
  }

  openOrderDetail(order: any) {
    this.selectedOrder = order;
    new bootstrap.Modal(document.getElementById('orderDetailModal')).show();
  }

  openCustomOrderForm(order: any) {
    this.selectedOrder = order;
    new bootstrap.Modal(document.getElementById('customFormModal')).show();
  }

  quoteActionFor(order: any): 'send' | 'correct' | 'requote' | null {
    if (order.status === 'waiting_quote' || (order.status === 'quoted' && !order.quoteVersion && !order.quotedPrice)) return 'send';
    if (order.status !== 'quoted' || !order.quoteVersion || !(order.quotedPrice > 0)) return null;
    if (order.quoteDecision === 'pending') return 'correct';
    if (order.quoteDecision === 'negotiating' && order.quoteNegotiation?.quoteVersion === order.quoteVersion
      && order.quoteNegotiation.proposedPrice > 0 && !order.quoteNegotiation.respondedAt) return 'requote';
    return null;
  }

  quoteDecisionLabel(decision: string): string {
    return ({ pending: 'Đang chờ khách phản hồi', accepted: 'Khách đã đồng ý báo giá',
      rejected: 'Khách đã từ chối báo giá', negotiating: 'Khách yêu cầu thương lượng' } as Record<string, string>)[decision] || '';
  }

  openQuoteForm(order: any): void {
    const action = this.quoteActionFor(order);
    if (!action || this.quoteBusy) return;
    this.selectedOrder = order;
    this.quoteAction = action;
    this.quoteError = '';
    this.quoteSuccess = '';
    this.quotePrice = action === 'correct' ? order.quotedPrice : null;
    this.quoteDate = action === 'correct' ? order.quoteDate : new Date().toISOString().slice(0, 10);
    this.quoteNote = action === 'correct' ? order.quoteNote || '' : '';

    const details = document.getElementById('customFormModal');
    if (details) bootstrap.Modal.getInstance(details)?.hide();
    const modal = document.getElementById('quoteModal');
    if (modal) bootstrap.Modal.getOrCreateInstance(modal).show();
  }

  get validQuoteForm(): boolean {
    const date = new Date(this.quoteDate + 'T00:00:00Z');
    return this.quotePrice !== null && Number.isFinite(this.quotePrice) && this.quotePrice > 0
      && /^\d{4}-\d{2}-\d{2}$/.test(this.quoteDate) && Number.isFinite(date.getTime())
      && date.toISOString().slice(0, 10) === this.quoteDate && this.quoteNote.length <= 1000;
  }

  submitQuote(): void {
    const order = this.selectedOrder;
    if (!order || this.quoteBusy || !this.validQuoteForm) return;
    this.saveCustomQuote(order, {
      quoteAction: this.quoteAction, quoteVersion: order.quoteVersion ?? 0,
      quotedPrice: this.quotePrice, quoteDate: this.quoteDate, quoteNote: this.quoteNote
    }, 'Đã lưu báo giá.');
  }

  updateCustomProgress(order: any, status: 'processing' | 'completed'): void {
    if (this.quoteBusy || (status === 'processing' ? order.status !== 'quoted' || order.quoteDecision !== 'accepted'
      : order.status !== 'processing')) return;
    this.saveCustomQuote(order, { status }, 'Đã cập nhật tiến độ yêu cầu.');
  }

  private saveCustomQuote(order: any, payload: any, success: string): void {
    this.quoteBusy = true;
    this.quoteError = '';
    this.quoteSuccess = '';
    const isQuote = Boolean(payload.quoteAction);
    this.adminApi.updateCustomOrder(order.id, payload).subscribe({
      next: (saved) => {
        this.quoteBusy = false;
        if (saved?.id !== order.id || (isQuote && (saved.status !== 'quoted'
          || saved.quotedPrice !== payload.quotedPrice || saved.quoteDate !== payload.quoteDate
          || saved.quoteNote !== payload.quoteNote.trim() || !Number.isSafeInteger(saved.quoteVersion)))
          || (!isQuote && saved.status !== payload.status)) {
          this.quoteError = 'Máy chủ chưa xác nhận dữ liệu cập nhật. Vui lòng kiểm tra yêu cầu.';
          this.loadOrders();
          this.changeDetectorRef.markForCheck();
          return;
        }
        const updated = this.normalizeCustomOrder(saved);
        this.originalOrders = this.originalOrders.map(item => item.isCustomOrder && item.id === order.id ? updated : item);
        if (this.selectedOrder?.id === order.id) this.selectedOrder = updated;
        this.applyFilters();
        this.quoteSuccess = success;
        this.loadOrders();
        if (isQuote) {
          const modal = document.getElementById('quoteModal');
          if (modal) bootstrap.Modal.getInstance(modal)?.hide();
        }
        this.changeDetectorRef.markForCheck();
      },
      error: (error) => {
        this.quoteBusy = false;
        this.quoteError = error.error?.message || 'Không thể cập nhật yêu cầu. Vui lòng thử lại.';
        if (error.status === 409) this.loadOrders();
        this.changeDetectorRef.markForCheck();
      }
    });
  }
}
