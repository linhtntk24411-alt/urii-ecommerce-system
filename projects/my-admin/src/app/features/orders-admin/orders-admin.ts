import { ChangeDetectorRef, Component, OnInit, HostListener, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
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
export class OrdersAdmin implements OnInit {
  private readonly socket = inject(AdminSocketService);
  constructor(
    private adminApi: AdminApiService,
    private changeDetectorRef: ChangeDetectorRef,
    private route: ActivatedRoute
  ) {}
  // --- THĂM ÄOáº N NĂ€Y Äá»‚ FIX Lá»–I DROPDOWN ---
  activeDropdownId: string | null = null;

  toggleDropdown(id: string, event: Event) {
    event.stopPropagation();
    this.activeDropdownId = this.activeDropdownId === id ? null : id;
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: Event) {
    this.activeDropdownId = null; // Click ra ngoĂ i tá»± Ä‘Ă³ng menu
  }
  // ------------------------------------------
  Math = Math;
  // ThĂªm láº¡i hĂ m MathMin cho file HTML sá»­ dá»¥ng
  MathMin(a: number, b: number) { return Math.min(a, b); }

  // --- Data ---
  originalOrders: any[] = [];
  orders: any[] = [];
  orderLoadError = '';
  private orderDataSubscription?: Subscription;
  private pendingSearchId: string | null = null;
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

  // --- Modal Data ---
  selectedOrder: any = null;
  quotePrice: number | null = null;
  quoteDate: string = '';
  quoteNote: string = '';
  editQuotePrice: number | null = null;
  editQuoteDate: string = '';
  editQuoteNote: string = '';

  // --- Status Map ---
  statusMap: { [key: string]: any } = {
    "pending": { text: "Chá» xĂ¡c nháº­n", class: "badge-status-pending" },
    "approved": { text: "ÄĂ£ xĂ¡c nháº­n", class: "badge-status-approved" },
    "quoted": { text: "ÄĂ£ bĂ¡o giĂ¡", class: "badge-status-approved" },
    "completed": { text: "HoĂ n thĂ nh", class: "badge-status-completed" },
    "cancelled": { text: "ÄĂ£ há»§y", class: "badge-status-cancelled" },
    "pending_approval": { text: "Chá» duyá»‡t", class: "badge-status-pending_approval" },
    "waiting_quote": { text: "Chá» bĂ¡o giĂ¡", class: "badge-status-waiting_quote" },
    "processing": { text: "Äang gia cĂ´ng", class: "badge-status-processing" }
  };

  ngOnInit(): void {
    this.route.queryParamMap.subscribe(params => {
      this.pendingSearchId = params.get('searchType') === 'order'
        ? params.get('searchId')
        : null;
      this.applySearchTarget();
    });
    this.loadCustomerAvatars();
    this.loadOrders();
    this.socket.onCrudChange('orders').subscribe(() => this.loadOrders());
    this.socket.onCrudChange('customOrders').subscribe(() => this.loadOrders());
  }

  searchTargetId(id: string | number): string {
    return `admin-search-target-order-${encodeURIComponent(String(id))}`;
  }

  private applySearchTarget(): void {
    const id = this.pendingSearchId;
    if (!id) return;

    const order = this.originalOrders.find(item => String(item.id) === id);
    if (!order) return;

    this.searchQuery = '';
    this.filterStatus = '';
    this.filterDate = '';
    this.filterSort = 'newest';
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

    this.pendingSearchId = null;
    this.scrollToSearchTarget(this.searchTargetId(id));
  }

  private scrollToSearchTarget(elementId: string): void {
    if (typeof document === 'undefined' || typeof requestAnimationFrame === 'undefined') return;
    requestAnimationFrame(() => {
      const row = document.getElementById(elementId);
      if (!(row instanceof HTMLTableRowElement)) return;
      row.scrollIntoView({ behavior: 'smooth', block: 'center' });
      const cells = Array.from(row.cells);
      const originalStyles = cells.map(cell => ({
        backgroundColor: cell.style.getPropertyValue('background-color'),
        backgroundPriority: cell.style.getPropertyPriority('background-color')
      }));

      cells.forEach(cell => {
        cell.style.setProperty('background-color', '#fffbea', 'important');
      });

      window.setTimeout(() => {
        cells.forEach((cell, index) => {
          const original = originalStyles[index];
          if (original.backgroundColor) {
            cell.style.setProperty('background-color', original.backgroundColor, original.backgroundPriority);
          } else {
            cell.style.removeProperty('background-color');
          }
        });
      }, 3000);
    });
  }

  // --- Computed Lists ---
  get regularOrders() { return this.orders.filter(o => o.status !== 'pending_approval' && !o.isCustomOrder); }
  get pagedRegularOrders() {
    const start = (this.currentPage - 1) * this.ITEMS_PER_PAGE;
    return this.regularOrders.slice(start, start + this.ITEMS_PER_PAGE);
  }

  get cancelRequests() { return this.orders.filter(o => o.status === 'pending_approval'); }
  get pagedCancelRequests() {
    const start = (this.currentCancelPage - 1) * this.ITEMS_PER_PAGE;
    return this.cancelRequests.slice(start, start + this.ITEMS_PER_PAGE);
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
    this.orderDataSubscription?.unsubscribe();
    this.orderDataSubscription = combineLatest({
      response: this.adminApi.getOrders(),
      customResponse: this.adminApi.getCustomOrders(),
      products: this.adminApi.products$
    }).subscribe({
      next: ({ response, customResponse, products }) => {
        const orderList = Array.isArray(response)
          ? response
          : Array.isArray(response?.orders)
            ? response.orders
            : null;
        if (!orderList) {
          console.error('API Ä‘Æ¡n hĂ ng tráº£ vá» dá»¯ liá»‡u khĂ´ng há»£p lá»‡:', response);
          return;
        }

        const customOrderList = Array.isArray(customResponse)
          ? customResponse
          : Array.isArray(customResponse?.customOrders)
            ? customResponse.customOrders
            : null;
        if (!customOrderList) {
          this.orderLoadError = 'MĂ¡y chá»§ tráº£ vá» danh sĂ¡ch Ä‘Æ¡n hĂ ng custom khĂ´ng há»£p lá»‡.';
          console.error('API Ä‘Æ¡n hĂ ng custom tráº£ vá» dá»¯ liá»‡u khĂ´ng há»£p lá»‡:', customResponse);
          return;
        }

        const regularOrders = orderList.map((item: any) => {
          const orderItems = Array.isArray(item.items)
            ? item.items.map((orderItem: any) => this.normalizeOrderItem(orderItem, products))
            : [];
          const name = item.userName || item.address?.name || 'KhĂ¡ch hĂ ng';
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
            'chá» xĂ¡c nháº­n': 'pending',
            'approved': 'approved',
            'Ä‘Ă£ xĂ¡c nháº­n': 'approved',
            'completed': 'completed',
            'hoĂ n thĂ nh': 'completed',
            'cancelled': 'cancelled',
            'canceled': 'cancelled',
            'Ä‘Ă£ há»§y': 'cancelled',
            'quoted': 'approved',
            'Ä‘Ă£ bĂ¡o giĂ¡': 'approved',
            'pending_approval': 'pending_approval',
            'chá» duyá»‡t': 'pending_approval',
            'waiting_quote': 'waiting_quote',
            'chá» bĂ¡o giĂ¡': 'waiting_quote',
            'processing': 'processing',
            'Ä‘ang gia cĂ´ng': 'processing'
          };
          const cancellationStatusAliases: { [key: string]: string } = {
            pending_approval: 'pending_approval',
            'chá» duyá»‡t': 'pending_approval',
            'chá» shop xĂ¡c nháº­n': 'pending_approval',
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
        });

        this.originalOrders = [
          ...regularOrders,
          ...customOrderList.map((item: any) => this.normalizeCustomOrder(item))
        ];
        this.orders = [...this.originalOrders];
        this.applySearchTarget();
        this.changeDetectorRef.markForCheck();
      },
      error: (err: any) => {
        console.error('Lá»—i táº£i Ä‘Æ¡n hĂ ng:', err);
        this.orderLoadError = err.status === 401 || err.status === 403
          ? 'PhiĂªn Ä‘Äƒng nháº­p khĂ´ng há»£p lá»‡ hoáº·c Ä‘Ă£ háº¿t háº¡n. Vui lĂ²ng Ä‘Äƒng nháº­p láº¡i Ä‘á»ƒ xem Ä‘Æ¡n hĂ ng.'
          : 'KhĂ´ng thá»ƒ táº£i Ä‘Æ¡n hĂ ng. Vui lĂ²ng thá»­ láº¡i sau.';
        this.originalOrders = [];
        this.orders = [];
        this.changeDetectorRef.markForCheck();
      }
    });
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
      name: orderItem.name || orderItem.productName || product?.name || `Sáº£n pháº©m #${orderItem.productId || ''}`,
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

    return {
      ...item,
      id: String(item.id || item._id || ''),
      isCustomOrder: true,
      customerName: item.fullName || 'KhĂ¡ch hĂ ng',
      customerImage: this.customerAvatars.get(
        this.normalizeCustomerName(item.fullName || '')
      ) || 'images/avatar-non.jpg',
      phone: item.phone || '',
      email: item.email || '',
      date,
      product: item.requestName || 'YĂªu cáº§u thiáº¿t káº¿ custom',
      customDetails: Object.fromEntries(Object.entries({
        'TĂªn máº«u yĂªu cáº§u': item.requestName || '',
        'KĂ­ch thÆ°á»›c': item.size || '',
        'Loáº¡i háº¡t': item.beadType || '',
        'MĂ£ máº«u tham kháº£o': item.mapId || ''
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
      .catch(error => console.error('Lá»—i táº£i áº£nh Ä‘áº¡i diá»‡n khĂ¡ch hĂ ng:', error));
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

  // --- Filter ---
  applyFilters() {
    const search = this.searchQuery.toLowerCase().trim();
    let filteredRegular = this.originalOrders.filter(o => {
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

    if (this.filterSort === 'newest') filteredRegular.reverse();

    const custom = this.originalOrders.filter(o => o.isCustomOrder === true);
    const cancel = this.originalOrders.filter(o => o.status === 'pending_approval');
    
    this.orders = [...filteredRegular, ...custom, ...cancel];
    this.currentPage = 1;
  }

  // --- Actions ---
  updateOrderStatus(id: string, newStatus: string) {
  const statusPayloadMap: Record<string, { statusId: string; status: string; statusType: string }> = {
    pending: { statusId: 'pending', status: 'Chá» xĂ¡c nháº­n', statusType: 'pending' },
    approved: { statusId: 'processing', status: 'ÄĂ£ xĂ¡c nháº­n', statusType: 'approved' },
    completed: { statusId: 'completed', status: 'ÄĂ£ giao', statusType: 'completed' },
    cancelled: { statusId: 'cancelled', status: 'ÄĂ£ há»§y', statusType: 'cancelled' }
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
      console.error('Lá»—i cáº­p nháº­t tráº¡ng thĂ¡i:', err);
      alert('KhĂ´ng thá»ƒ cáº­p nháº­t tráº¡ng thĂ¡i Ä‘Æ¡n hĂ ng!');
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
        alert('ÄĂ£ xĂ³a Ä‘Æ¡n hĂ ng!');
      },
      error: (err) => {
        console.error('Lá»—i xĂ³a Ä‘Æ¡n hĂ ng:', err);
        this.isDeletingOrder = false;
        alert('KhĂ´ng thá»ƒ xĂ³a Ä‘Æ¡n hĂ ng!');
      }
    });
  }

  handleCancelRequest(id: string, isApproved: boolean): void {
    const order = this.originalOrders.find(o => o.id === id);

    if (!order) {
      alert('KhĂ´ng tĂ¬m tháº¥y Ä‘Æ¡n hĂ ng!');
      return;
    }

    const newStatus = isApproved ? 'cancelled' : 'pending';

    const confirmMessage = isApproved
      ? `Báº¡n cĂ³ cháº¯c cháº¯n muá»‘n duyá»‡t há»§y Ä‘Æ¡n hĂ ng #${id}?`
      : `Báº¡n cĂ³ cháº¯c cháº¯n muá»‘n tá»« chá»‘i yĂªu cáº§u há»§y Ä‘Æ¡n #${id}?`;

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
            ? 'ÄĂ£ duyá»‡t yĂªu cáº§u há»§y Ä‘Æ¡n hĂ ng!'
            : 'ÄĂ£ tá»« chá»‘i yĂªu cáº§u há»§y Ä‘Æ¡n hĂ ng!'
        );
      },
      error: (err) => {
        console.error('Lá»—i xá»­ lĂ½ yĂªu cáº§u há»§y Ä‘Æ¡n:', err);
        alert('KhĂ´ng thá»ƒ cáº­p nháº­t yĂªu cáº§u há»§y Ä‘Æ¡n. Vui lĂ²ng thá»­ láº¡i!');
      }
    });
  }

  // --- Modals Logic ---
  openOrderDetail(order: any) {
    this.selectedOrder = order;
    new bootstrap.Modal(document.getElementById('orderDetailModal')).show();
  }

  openCustomOrderForm(order: any) {
    this.selectedOrder = order;
    new bootstrap.Modal(document.getElementById('customFormModal')).show();
  }

  openQuoteForm(order: any) {
    this.selectedOrder = order;
    this.quotePrice = order.quotedPrice || null;
    this.quoteDate = order.quoteDate || new Date().toISOString().split('T')[0];
    this.quoteNote = order.quoteNote || '';
    
    const customModalEl = document.getElementById('customFormModal');
    if (customModalEl) {
      const customModal = bootstrap.Modal.getInstance(customModalEl);
      if (customModal) customModal.hide();
    }
    
    new bootstrap.Modal(document.getElementById('quoteModal')).show();
  }

  submitQuote() {
    if (!this.quotePrice || this.quotePrice <= 0) {
      alert('Vui lĂ²ng nháº­p giĂ¡ bĂ¡o há»£p lá»‡!'); return;
    }
    const order = this.originalOrders.find(o => o.id === this.selectedOrder.id);
    if (order) {
      order.quotedPrice = this.quotePrice;
      order.quoteDate = this.quoteDate;
      order.quoteNote = this.quoteNote;
      order.total = this.quotePrice;
      order.status = 'approved';
      this.adminApi.updateCustomOrder(order.id, {
        quotedPrice: this.quotePrice,
        status: 'quoted',
        quoteNote: this.quoteNote,
        quoteDate: this.quoteDate
      }).subscribe({
        next: () => this.loadOrders(),
        error: (err) => console.error('Loi gui bao gia qua API:', err)
      });
      this.saveOrders();
      bootstrap.Modal.getInstance(document.getElementById('quoteModal')).hide();
      alert(`ÄĂ£ gá»­i bĂ¡o giĂ¡ thĂ nh cĂ´ng!`);
    }
  }

  editQuote(order: any) {
    if (!order.quotedPrice || order.quotedPrice <= 0) {
      alert('ÄÆ¡n hĂ ng nĂ y chÆ°a cĂ³ bĂ¡o giĂ¡. Vui lĂ²ng bĂ¡o giĂ¡ trÆ°á»›c!'); return;
    }
    this.selectedOrder = order;
    this.editQuotePrice = order.quotedPrice;
    this.editQuoteDate = new Date().toISOString().split('T')[0];
    this.editQuoteNote = order.quoteNote || '';
    new bootstrap.Modal(document.getElementById('editQuoteModal')).show();
  }

  updateQuote() {
    if (!this.editQuotePrice || this.editQuotePrice <= 0) {
      alert('Vui lĂ²ng nháº­p giĂ¡ má»›i há»£p lá»‡!'); return;
    }
    const order = this.originalOrders.find(o => o.id === this.selectedOrder.id);
    if (order) {
      order.quotedPrice = this.editQuotePrice;
      order.quoteDate = this.editQuoteDate;
      order.quoteNote = this.editQuoteNote;
      order.total = this.editQuotePrice;
      this.adminApi.updateCustomOrder(order.id, {
        quotedPrice: this.editQuotePrice,
        quoteNote: this.editQuoteNote,
        quoteDate: this.editQuoteDate
      }).subscribe({
        next: () => this.loadOrders(),
        error: (err) => console.error('Loi cap nhat bao gia qua API:', err)
      });
      this.saveOrders();
      bootstrap.Modal.getInstance(document.getElementById('editQuoteModal')).hide();
      alert(`ÄĂ£ cáº­p nháº­t bĂ¡o giĂ¡ thĂ nh cĂ´ng!`);
    }
  }
}