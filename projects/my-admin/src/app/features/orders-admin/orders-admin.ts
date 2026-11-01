import { Component, OnInit, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AdminApiService } from '../../core/services/admin-api.service';

declare var bootstrap: any;

@Component({
  selector: 'app-orders-admin',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './orders-admin.html',
  styleUrls: ['./orders-admin.css']
})
export class OrdersAdmin implements OnInit {
  constructor(private adminApi: AdminApiService) {}
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
    "pending": { text: "Chờ xác nhận", class: "badge-status-pending" },
    "approved": { text: "Đã xác nhận", class: "badge-status-approved" },
    "completed": { text: "Hoàn thành", class: "badge-status-completed" },
    "cancelled": { text: "Đã hủy", class: "badge-status-cancelled" },
    "pending_approval": { text: "Chờ duyệt", class: "badge-status-pending_approval" },
    "waiting_quote": { text: "Chờ báo giá", class: "badge-status-waiting_quote" },
    "processing": { text: "Đang gia công", class: "badge-status-processing" }
  };

  ngOnInit(): void {
    this.loadOrders();
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
  get statCancel() { return this.orders.filter(o => o.status === 'cancelled').length; }

  // --- Logic Load Data ---
 loadOrders() {
    (this.adminApi.getOrders() as any).subscribe({
      next: (res: any) => {
        const orderList = Array.isArray(res) ? res : (res?.orders || res?.data || []);

        this.originalOrders = orderList.map((item: any) => {
          // Lấy tên từ userName trên MongoDB Cloud
          const name = item.userName || item.customerName || 'Khách hàng';
          
          // Xử lý chuỗi tiền tệ (ví dụ "251.750đ" -> số để tính toán nếu cần)
          let rawTotal = item.total;
          if (typeof rawTotal === 'string') {
            rawTotal = Number(rawTotal.replace(/[^0-9]/g, '')) || 0;
          }

          // Ánh xạ trạng thái tiếng Việt từ DB sang mã code của giao diện
          let statusCode = 'pending';
          const dbStatus = (item.status || '').toLowerCase();
          if (dbStatus.includes('giao') || dbStatus.includes('xác nhận')) statusCode = 'approved';
          else if (dbStatus.includes('hoàn thành')) statusCode = 'completed';
          else if (dbStatus.includes('hủy')) statusCode = 'cancelled';

          return {
            ...item,
            id: item.id || item._id,
            customerName: name, // Khớp với HTML
            customerAvatar: name.length >= 2 ? name.substring(0, 2).toUpperCase() : 'KH',
            total: rawTotal,
            status: item.statusType || statusCode
          };
        });

        this.orders = [...this.originalOrders];
      },
      error: (err: any) => {
        console.error('Lỗi tải đơn hàng:', err);
        this.originalOrders = [];
        this.orders = [];
      }
    });
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
      const matchSearch = o.id.toLowerCase().includes(search) || o.customerName.toLowerCase().includes(search);
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
    const order = this.originalOrders.find(o => o.id === id);
    if (order) {
      order.status = newStatus;
      this.saveOrders();
      this.activeDropdownId = null;
    }
  }

  deleteOrder(id: string) {
    if (confirm(`Bạn có chắc chắn muốn xóa đơn hàng #${id} không?`)) {
      this.originalOrders = this.originalOrders.filter(o => o.id !== id);
      this.saveOrders();
    }
  }

  handleCancelRequest(id: string, isApproved: boolean) {
    const order = this.originalOrders.find(o => o.id === id);
    if (order) {
      order.status = isApproved ? 'cancelled' : 'pending';
      this.saveOrders();
    }
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
      alert('Vui lòng nhập giá báo hợp lệ!'); return;
    }
    const order = this.originalOrders.find(o => o.id === this.selectedOrder.id);
    if (order) {
      order.quotedPrice = this.quotePrice;
      order.quoteDate = this.quoteDate;
      order.quoteNote = this.quoteNote;
      order.total = this.quotePrice;
      order.status = 'approved';
      this.saveOrders();
      bootstrap.Modal.getInstance(document.getElementById('quoteModal')).hide();
      alert(`Đã gửi báo giá thành công!`);
    }
  }

  editQuote(order: any) {
    if (!order.quotedPrice || order.quotedPrice <= 0) {
      alert('Đơn hàng này chưa có báo giá. Vui lòng báo giá trước!'); return;
    }
    this.selectedOrder = order;
    this.editQuotePrice = order.quotedPrice;
    this.editQuoteDate = new Date().toISOString().split('T')[0];
    this.editQuoteNote = order.quoteNote || '';
    new bootstrap.Modal(document.getElementById('editQuoteModal')).show();
  }

  updateQuote() {
    if (!this.editQuotePrice || this.editQuotePrice <= 0) {
      alert('Vui lòng nhập giá mới hợp lệ!'); return;
    }
    const order = this.originalOrders.find(o => o.id === this.selectedOrder.id);
    if (order) {
      order.quotedPrice = this.editQuotePrice;
      order.quoteDate = this.editQuoteDate;
      order.quoteNote = this.editQuoteNote;
      order.total = this.editQuotePrice;
      this.saveOrders();
      bootstrap.Modal.getInstance(document.getElementById('editQuoteModal')).hide();
      alert(`Đã cập nhật báo giá thành công!`);
    }
  }
}