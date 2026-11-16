import { CommonModule, isPlatformBrowser } from '@angular/common';
import {
  ChangeDetectorRef,
  Component,
  HostListener,
  inject,
  OnInit,
  PLATFORM_ID,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { ToastService } from '../../../core/services/toast.service';
import {
  UserVoucherItem,
  VoucherCheckResult,
  VoucherDetail,
  VoucherService,
} from '../../../core/services/voucher.service';

export type VoucherTab = 'all' | 'available' | 'used' | 'expired';
export type VoucherTypeFilter = 'all' | 'percent' | 'fixed' | 'shipping' | 'birthday';

@Component({
  selector: 'app-my-vouchers',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './my-vouchers.html',
  styleUrl: './my-vouchers.css',
})
export class MyVouchers implements OnInit {
  private readonly voucherService = inject(VoucherService);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);
  private readonly changeDetectorRef = inject(ChangeDetectorRef);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  vouchers: UserVoucherItem[] = [];
  unclaimedCount = 0;
  isLoading = true;
  requiresLogin = false;
  errorMessage = '';

  activeTab: VoucherTab = 'all';
  typeFilter: VoucherTypeFilter = 'all';
  searchQuery = '';

  inputVoucherCode = '';
  isChecking = false;
  checkResult: VoucherCheckResult | null = null;
  showResultModal = false;

  isClaiming = false;
  isClaimingAll = false;
  copiedCode: string | null = null;

  @HostListener('document:keydown.escape')
  onEscapeKey(): void {
    if (this.showResultModal) {
      this.closeResultModal();
    }
  }

  ngOnInit(): void {
    if (!this.isBrowser) return;
    this.loadVouchers();
    this.checkUnclaimedVouchers();
  }

  getToken(): string {
    if (!this.isBrowser) return '';
    const token =
      localStorage.getItem('authToken') ||
      localStorage.getItem('urii.auth.token') ||
      '';
    const isLoggedIn =
      localStorage.getItem('isLoggedIn') === 'true' ||
      localStorage.getItem('urii.auth.user') !== null;
    return isLoggedIn && token ? token : '';
  }

  loadVouchers(): void {
    const token = this.getToken();
    if (!token) {
      this.requiresLogin = true;
      this.isLoading = false;
      this.changeDetectorRef.markForCheck();
      return;
    }

    this.isLoading = true;
    this.errorMessage = '';

    this.voucherService.getMyVouchers(token).subscribe({
      next: (list) => {
        this.vouchers = Array.isArray(list) ? list : [];
        this.isLoading = false;
        this.changeDetectorRef.markForCheck();
      },
      error: (err) => {
        this.isLoading = false;
        this.errorMessage =
          err.error?.message || 'Không thể tải kho voucher của bạn lúc này.';
        this.changeDetectorRef.markForCheck();
      },
    });
  }

  checkUnclaimedVouchers(): void {
    const token = this.getToken();
    this.voucherService.getUnclaimedVouchers(token || undefined).subscribe({
      next: (res) => {
        if (res && Array.isArray(res.vouchers)) {
          this.unclaimedCount = res.vouchers.length;
          this.changeDetectorRef.markForCheck();
        }
      },
      error: () => {
        // Im lặng nếu không kiểm tra được unclaimed
      },
    });
  }

  checkVoucherCode(): void {
    const code = this.inputVoucherCode.trim().toUpperCase();
    if (!code) {
      this.toast.show('Vui lòng nhập mã voucher cần kiểm tra.', 'error');
      return;
    }

    this.isChecking = true;
    this.voucherService.checkVoucher(code).subscribe({
      next: (res) => {
        this.isChecking = false;
        this.checkResult = res;
        this.showResultModal = true;
        if (res.valid) {
          this.toast.show(res.message || `Mã "${code}" hợp lệ!`, 'success');
        } else {
          this.toast.show(res.message || `Mã "${code}" không hợp lệ.`, 'error');
        }
        this.changeDetectorRef.markForCheck();
      },
      error: (err) => {
        this.isChecking = false;
        const msg = err.error?.message || 'Tiếc quá, chúng tớ không tìm thấy, cậu hãy nhập lại nữa nhé';
        this.checkResult = {
          valid: false,
          code,
          reason: 'NOT_FOUND',
          message: msg,
        };
        this.showResultModal = true;
        this.toast.show(msg, 'error');
        this.changeDetectorRef.markForCheck();
      },
    });
  }

  closeResultModal(): void {
    this.showResultModal = false;
    this.changeDetectorRef.markForCheck();
  }

  retryCheck(): void {
    this.showResultModal = false;
    this.inputVoucherCode = '';
    this.changeDetectorRef.markForCheck();
  }

  claimInputCode(): void {
    const token = this.getToken();
    if (!token) {
      this.requiresLogin = true;
      return;
    }

    const code = this.inputVoucherCode.trim().toUpperCase();
    if (!code) {
      this.toast.show('Vui lòng nhập mã khuyến mãi.', 'error');
      return;
    }

    this.isClaiming = true;
    this.voucherService.claimVoucher(code, token).subscribe({
      next: (res) => {
        this.isClaiming = false;
        this.inputVoucherCode = '';
        this.toast.show(
          res.message || `Đã thêm mã "${code}" vào kho voucher của bạn!`,
          'success'
        );
        this.loadVouchers();
        this.checkUnclaimedVouchers();
        this.changeDetectorRef.markForCheck();
      },
      error: (err) => {
        this.isClaiming = false;
        this.toast.show(
          err.error?.message || 'Mã voucher không hợp lệ hoặc đã có trong kho.',
          'error'
        );
        this.changeDetectorRef.markForCheck();
      },
    });
  }

  claimAll(): void {
    const token = this.getToken();
    if (!token) {
      this.requiresLogin = true;
      return;
    }

    this.isClaimingAll = true;
    this.voucherService.claimAllVouchers(token).subscribe({
      next: (res) => {
        this.isClaimingAll = false;
        this.toast.show(
          res.message || 'Chúc mừng! Đã nhận toàn bộ voucher vào kho.',
          'success'
        );
        this.unclaimedCount = 0;
        this.loadVouchers();
        this.changeDetectorRef.markForCheck();
      },
      error: (err) => {
        this.isClaimingAll = false;
        this.toast.show(
          err.error?.message || 'Không thể nhận tất cả voucher lúc này.',
          'error'
        );
        this.changeDetectorRef.markForCheck();
      },
    });
  }

  copyCode(code: string): void {
    if (!code) return;
    if (this.isBrowser && navigator.clipboard?.writeText) {
      navigator.clipboard
        .writeText(code)
        .then(() => {
          this.copiedCode = code;
          this.toast.show(`Đã sao chép mã "${code}"!`, 'success');
          this.changeDetectorRef.markForCheck();
          setTimeout(() => {
            this.copiedCode = null;
            this.changeDetectorRef.markForCheck();
          }, 2500);
        })
        .catch(() => {
          this.fallbackCopy(code);
        });
    } else {
      this.fallbackCopy(code);
    }
  }

  private fallbackCopy(code: string): void {
    this.copiedCode = code;
    this.toast.show(`Mã ưu đãi: ${code}`, 'info');
    this.changeDetectorRef.markForCheck();
    setTimeout(() => {
      this.copiedCode = null;
      this.changeDetectorRef.markForCheck();
    }, 2500);
  }

  useVoucher(item?: UserVoucherItem | VoucherDetail | null): void {
    if (item && 'isUsed' in item && this.getStatus(item as UserVoucherItem) !== 'available') {
      return;
    }
    this.closeResultModal();
    void this.router.navigate(['/products']);
  }

  get filteredVouchers(): UserVoucherItem[] {
    return this.vouchers.filter((item) => {
      const status = this.getStatus(item);

      // Tab filter
      if (this.activeTab !== 'all' && status !== this.activeTab) {
        return false;
      }

      // Type filter
      if (this.typeFilter !== 'all') {
        if (this.typeFilter === 'birthday') {
          const isBirthday =
            item.source === 'birthday' ||
            item.code?.toUpperCase().includes('BD') ||
            item.voucherId === 'voucher-bd50';
          if (!isBirthday) return false;
        } else if (item.voucher?.type !== this.typeFilter) {
          return false;
        }
      }

      // Search query
      if (this.searchQuery.trim()) {
        const query = this.searchQuery.toLowerCase().trim();
        const code = (item.code || item.voucher?.code || '').toLowerCase();
        const name = (item.voucher?.name || '').toLowerCase();
        const desc = (item.voucher?.description || '').toLowerCase();
        if (
          !code.includes(query) &&
          !name.includes(query) &&
          !desc.includes(query)
        ) {
          return false;
        }
      }

      return true;
    });
  }

  getStatus(item: UserVoucherItem): 'available' | 'used' | 'expired' {
    if (item.isUsed) return 'used';
    if (this.isVoucherExpired(item.voucher)) return 'expired';
    if (item.voucher && item.voucher.isActive === false) return 'expired';
    return 'available';
  }

  getStatusLabel(item: UserVoucherItem): string {
    const status = this.getStatus(item);
    switch (status) {
      case 'available':
        return 'Khả dụng';
      case 'used':
        return 'Đã sử dụng';
      case 'expired':
        return 'Đã hết hạn';
    }
  }

  isVoucherExpired(voucher?: VoucherDetail | null): boolean {
    if (!voucher || !voucher.endDate) return false;
    const parts = voucher.endDate.split('/');
    if (parts.length === 3) {
      const day = parseInt(parts[0], 10);
      const month = parseInt(parts[1], 10) - 1;
      const year = parseInt(parts[2], 10);
      const expiry = new Date(year, month, day, 23, 59, 59);
      return new Date() > expiry;
    }
    const d = new Date(voucher.endDate);
    return !isNaN(d.getTime()) && new Date() > d;
  }

  get totalCount(): number {
    return this.vouchers.length;
  }

  get availableCount(): number {
    return this.vouchers.filter((v) => this.getStatus(v) === 'available').length;
  }

  get usedCount(): number {
    return this.vouchers.filter((v) => this.getStatus(v) === 'used').length;
  }

  get expiredCount(): number {
    return this.vouchers.filter((v) => this.getStatus(v) === 'expired').length;
  }

  formatDiscount(voucher?: VoucherDetail | null): string {
    if (!voucher) return 'Ưu đãi';
    if (voucher.type === 'percent') {
      return `Giảm ${voucher.discountValue}%`;
    }
    if (voucher.type === 'shipping') {
      return `Freeship ${Number(voucher.discountValue || 0).toLocaleString('vi-VN')}đ`;
    }
    return `Giảm ${Number(voucher.discountValue || 0).toLocaleString('vi-VN')}đ`;
  }

  formatMinOrder(minOrder?: number): string {
    if (!minOrder || minOrder <= 0) return 'Không giới hạn';
    return `Đơn tối thiểu ${Number(minOrder).toLocaleString('vi-VN')}đ`;
  }

  formatMaxDiscount(maxDiscount?: number): string {
    if (!maxDiscount || maxDiscount <= 0) return '';
    return `Tối đa ${Number(maxDiscount).toLocaleString('vi-VN')}đ`;
  }
}
