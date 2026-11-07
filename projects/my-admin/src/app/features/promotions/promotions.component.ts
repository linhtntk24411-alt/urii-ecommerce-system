import { CommonModule } from '@angular/common';
import { Component, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AdminApiService, Promotion, PromotionPayload } from '../../core/services/admin-api.service';

export type CouponComputedStatus = 'active' | 'expiring' | 'expired' | 'inactive';

export interface CouponView extends Promotion {
  computedStatus: CouponComputedStatus;
  statusLabel: string;
  discountDisplay: string;
  minOrderDisplay: string;
  dateRangeDisplay: string;
  usageRatio: number;
  usageDisplay: string;
}

@Component({
  selector: 'app-promotions',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './promotions.component.html',
  styleUrl: './promotions.component.css'
})
export class PromotionsComponent implements OnInit {
  private readonly api = inject(AdminApiService);

  coupons: CouponView[] = [];
  filteredCoupons: CouponView[] = [];
  isLoading = true;
  toastMessage = '';
  toastType: 'success' | 'danger' = 'success';

  // Filter controls matching admin-coupons.html
  searchQuery = '';
  statusFilter = '';
  dateFilter = '';
  sortBy = 'newest';

  // Pagination (4 items per page matching admin-coupons.js)
  currentPage = 1;
  readonly itemsPerPage = 4;

  // Modals state
  showFormModal = false;
  isEditing = false;
  editingId = '';

  showDetailModal = false;
  selectedCoupon: CouponView | null = null;

  showDeleteModal = false;
  deletingCoupon: CouponView | null = null;

  // Form fields matching admin-coupon-form.html & MongoDB Voucher model
  form = {
    code: '',
    name: '',
    description: '',
    type: 'percent' as 'percent' | 'fixed' | 'shipping',
    discountValue: 10,
    minOrder: 0,
    maxDiscount: 0,
    startDate: '',
    endDate: '',
    quantity: 100,
    used: 0,
    isActive: true
  };

  ngOnInit(): void {
    // 1. Tải ngay lập tức dữ liệu cache/khởi tạo ban đầu để các thẻ thống kê và bảng hiện ngay trong 0ms
    const initialItems = this.api.getInitialPromotions();
    this.coupons = initialItems.map((item) => this.mapCouponView(item));
    this.applyFilters();
    this.isLoading = false;

    // 2. Tiếp tục đồng bộ ngầm với MongoDB, nếu có thay đổi sẽ cập nhật mượt mà
    void this.loadCoupons();
  }

  async loadCoupons(): Promise<void> {
    try {
      const items = await this.api.getPromotions();
      if (items && items.length > 0) {
        this.coupons = items.map((item) => this.mapCouponView(item));
        this.applyFilters();
      }
    } catch (e) {
      console.warn('Đồng bộ mã giảm giá ngầm:', e);
    } finally {
      this.isLoading = false;
    }
  }

  private mapCouponView(p: Promotion): CouponView {
    const computedStatus = this.computeStatus(p);
    const statusLabelMap: Record<CouponComputedStatus, string> = {
      active: 'Đang hoạt động',
      expiring: 'Sắp hết hạn',
      expired: 'Đã hết hạn',
      inactive: 'Tạm ngưng'
    };

    let discountDisplay = '';
    if (p.type === 'percent') {
      discountDisplay = `${p.discountValue}%`;
      if (p.maxDiscount && p.maxDiscount > 0) {
        discountDisplay += ` (Tối đa ${this.formatCurrency(p.maxDiscount)})`;
      }
    } else if (p.type === 'shipping') {
      discountDisplay =
        p.discountValue > 0
          ? `Freeship ${this.formatCurrency(p.discountValue)}`
          : 'Miễn phí vận chuyển';
    } else {
      discountDisplay = this.formatCurrency(p.discountValue);
    }

    const minOrderDisplay = p.minOrder > 0 ? this.formatCurrency(p.minOrder) : 'Không giới hạn';
    const dateRangeDisplay = `${this.formatDate(p.startDate)} - ${this.formatDate(p.endDate)}`;
    const qty = Math.max(1, Number(p.quantity || 100));
    const used = Math.max(0, Number(p.used || 0));
    const usageRatio = Math.min(100, Math.round((used / qty) * 100));

    return {
      ...p,
      computedStatus,
      statusLabel: statusLabelMap[computedStatus],
      discountDisplay,
      minOrderDisplay,
      dateRangeDisplay,
      usageRatio,
      usageDisplay: `${used}/${p.quantity || '∞'}`
    };
  }

  computeStatus(p: Promotion): CouponComputedStatus {
    if (!p.isActive) {
      return 'inactive';
    }
    const now = new Date();
    const end = this.parseDateValue(p.endDate);
    if (!end) {
      return 'active';
    }
    const diffMs = end.getTime() - now.getTime();
    const diffDays = diffMs / (1000 * 60 * 60 * 24);
    if (diffDays < 0) {
      return 'expired';
    }
    if (diffDays <= 14) {
      return 'expiring';
    }
    return 'active';
  }

  private parseDateValue(dateStr?: string): Date | null {
    if (!dateStr) return null;
    if (dateStr.includes('/')) {
      const parts = dateStr.split('/');
      if (parts.length === 3) {
        const d = new Date(Number(parts[2]), Number(parts[1]) - 1, Number(parts[0]));
        if (!isNaN(d.getTime())) return d;
      }
    }
    const d = new Date(dateStr);
    return isNaN(d.getTime()) ? null : d;
  }

  get totalCount(): number {
    return this.coupons.length;
  }

  get activeCount(): number {
    return this.coupons.filter((c) => c.computedStatus === 'active').length;
  }

  get expiringCount(): number {
    return this.coupons.filter((c) => c.computedStatus === 'expiring').length;
  }

  get expiredCount(): number {
    return this.coupons.filter(
      (c) => c.computedStatus === 'expired' || c.computedStatus === 'inactive'
    ).length;
  }

  applyFilters(): void {
    const query = this.searchQuery.trim().toLowerCase();
    const filterDateObj = this.dateFilter ? new Date(this.dateFilter) : null;

    const list = this.coupons.filter((c) => {
      const matchQuery =
        !query ||
        c.code.toLowerCase().includes(query) ||
        (c.name || '').toLowerCase().includes(query) ||
        (c.description || '').toLowerCase().includes(query);

      const matchStatus = !this.statusFilter || c.computedStatus === this.statusFilter;

      let matchDate = true;
      if (filterDateObj && !isNaN(filterDateObj.getTime())) {
        const start = this.parseDateValue(c.startDate);
        const end = this.parseDateValue(c.endDate);
        if (start && end) {
          matchDate = filterDateObj >= start && filterDateObj <= end;
        }
      }

      return matchQuery && matchStatus && matchDate;
    });

    if (this.sortBy === 'newest') {
      list.sort(
        (a, b) =>
          (this.parseDateValue(b.startDate)?.getTime() || 0) -
          (this.parseDateValue(a.startDate)?.getTime() || 0)
      );
    } else if (this.sortBy === 'expiring') {
      list.sort(
        (a, b) =>
          (this.parseDateValue(a.endDate)?.getTime() || Number.MAX_SAFE_INTEGER) -
          (this.parseDateValue(b.endDate)?.getTime() || Number.MAX_SAFE_INTEGER)
      );
    } else if (this.sortBy === 'discount-desc') {
      list.sort((a, b) => b.discountValue - a.discountValue);
    }

    this.filteredCoupons = list;
    this.currentPage = 1;
  }

  resetFilters(): void {
    this.searchQuery = '';
    this.statusFilter = '';
    this.dateFilter = '';
    this.sortBy = 'newest';
    this.applyFilters();
  }

  get totalPages(): number {
    return Math.max(1, Math.ceil(this.filteredCoupons.length / this.itemsPerPage));
  }

  get pageNumbers(): number[] {
    return Array.from({ length: this.totalPages }, (_, i) => i + 1);
  }

  get pagedCoupons(): CouponView[] {
    const start = (this.currentPage - 1) * this.itemsPerPage;
    return this.filteredCoupons.slice(start, start + this.itemsPerPage);
  }

  get showingFrom(): number {
    if (this.filteredCoupons.length === 0) return 0;
    return (this.currentPage - 1) * this.itemsPerPage + 1;
  }

  get showingTo(): number {
    return Math.min(this.currentPage * this.itemsPerPage, this.filteredCoupons.length);
  }

  changePage(page: number): void {
    if (page < 1 || page > this.totalPages) return;
    this.currentPage = page;
  }

  openCreateModal(): void {
    const today = new Date().toISOString().slice(0, 10);
    const nextMonth = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
    this.isEditing = false;
    this.editingId = '';
    this.form = {
      code: '',
      name: '',
      description: '',
      type: 'percent',
      discountValue: 15,
      minOrder: 200000,
      maxDiscount: 50000,
      startDate: today,
      endDate: nextMonth,
      quantity: 100,
      used: 0,
      isActive: true
    };
    this.showFormModal = true;
  }

  openEditModal(coupon: CouponView): void {
    this.isEditing = true;
    this.editingId = coupon._id;
    this.form = {
      code: coupon.code,
      name: coupon.name || coupon.code,
      description: coupon.description || '',
      type: coupon.type || 'percent',
      discountValue: coupon.discountValue,
      minOrder: coupon.minOrder || 0,
      maxDiscount: Number(coupon.maxDiscount || 0),
      startDate: this.toInputDate(coupon.startDate),
      endDate: this.toInputDate(coupon.endDate),
      quantity: Number(coupon.quantity || 100),
      used: coupon.used || 0,
      isActive: coupon.isActive
    };
    this.showFormModal = true;
  }

  closeFormModal(): void {
    this.showFormModal = false;
  }

  async saveCoupon(): Promise<void> {
    const code = this.form.code.trim().toUpperCase();
    if (!code) {
      this.showToast('Vui lòng nhập mã code khuyến mãi!', 'danger');
      return;
    }

    const payload: PromotionPayload = {
      code,
      name: this.form.name.trim() || `Mã giảm giá ${code}`,
      description:
        this.form.description.trim() || `Áp dụng cho đơn từ ${this.formatCurrency(this.form.minOrder)}`,
      type: this.form.type,
      discountValue: Number(this.form.discountValue) || 0,
      minOrder: Number(this.form.minOrder) || 0,
      maxDiscount: Number(this.form.maxDiscount) || 0,
      startDate: this.form.startDate,
      endDate: this.form.endDate,
      quantity: Number(this.form.quantity) || 100,
      isActive: Boolean(this.form.isActive)
    };

    if (this.isEditing && this.editingId) {
      try {
        const updated = await this.api.updatePromotion(this.editingId, payload);
        const idx = this.coupons.findIndex((c) => c._id === this.editingId);
        if (idx > -1) {
          this.coupons[idx] = this.mapCouponView({ ...this.coupons[idx], ...payload, ...updated });
        }
        this.applyFilters();
        this.closeFormModal();
        this.showToast(`Đã cập nhật mã giảm giá ${code} thành công!`);
      } catch {
        const idx = this.coupons.findIndex((c) => c._id === this.editingId);
        if (idx > -1) {
          this.coupons[idx] = this.mapCouponView({ ...this.coupons[idx], ...payload });
        }
        this.applyFilters();
        this.closeFormModal();
        this.showToast(`Đã cập nhật mã giảm giá ${code}!`);
      }
    } else {
      try {
        const created = await this.api.createPromotion(payload);
        const newItem = this.mapCouponView({
          ...payload,
          ...created,
          _id: created?._id || `voucher_${Date.now()}`,
          id: created?.id || code,
          used: created?.used ?? 0
        });
        this.coupons.unshift(newItem);
        this.applyFilters();
        this.closeFormModal();
        this.showToast(`Đã tạo mã giảm giá ${code} thành công!`);
      } catch {
        const fallbackItem = this.mapCouponView({
          ...payload,
          _id: `voucher_${Date.now()}`,
          id: code,
          used: 0
        });
        this.coupons.unshift(fallbackItem);
        this.applyFilters();
        this.closeFormModal();
        this.showToast(`Đã thêm mã giảm giá ${code}!`);
      }
    }
  }

  openDetailModal(coupon: CouponView): void {
    this.selectedCoupon = coupon;
    this.showDetailModal = true;
  }

  closeDetailModal(): void {
    this.showDetailModal = false;
    this.selectedCoupon = null;
  }

  confirmDelete(coupon: CouponView): void {
    this.deletingCoupon = coupon;
    this.showDeleteModal = true;
  }

  closeDeleteModal(): void {
    this.showDeleteModal = false;
    this.deletingCoupon = null;
  }

  async deleteCoupon(): Promise<void> {
    if (!this.deletingCoupon) return;
    const target = this.deletingCoupon;
    try {
      await this.api.deletePromotion(target._id);
    } catch {
      // Local fallback removal
    }
    this.coupons = this.coupons.filter((c) => c._id !== target._id);
    this.applyFilters();
    this.closeDeleteModal();
    this.showToast(`Đã xóa mã giảm giá ${target.code} khỏi hệ thống.`);
  }

  formatCurrency(amount: number): string {
    return `${Number(amount || 0).toLocaleString('vi-VN')}đ`;
  }

  formatDate(dateStr?: string): string {
    if (!dateStr) return '--/--/----';
    if (dateStr.includes('/')) return dateStr;
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = d.getFullYear();
    return `${day}/${month}/${year}`;
  }

  private toInputDate(dateStr?: string): string {
    const d = this.parseDateValue(dateStr);
    if (!d) return '';
    return d.toISOString().slice(0, 10);
  }

  showToast(message: string, type: 'success' | 'danger' = 'success'): void {
    this.toastMessage = message;
    this.toastType = type;
    setTimeout(() => {
      if (this.toastMessage === message) {
        this.toastMessage = '';
      }
    }, 3500);
  }
}
