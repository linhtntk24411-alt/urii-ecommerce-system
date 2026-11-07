import { ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { inject, PLATFORM_ID } from '@angular/core';
import { Router, RouterModule } from '@angular/router'; 
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { finalize, map } from 'rxjs';
import { BlogPost, BlogService } from '../../core/services/blog.service';
import { CartService } from '../../core/services/cart.service';
import { ToastService } from '../../core/services/toast.service';

interface HomeProduct {
  id: string | number;
  slug: string;
  name: string;
  image: string;
  isSale: boolean;
  badge: string;
  originalPrice: number;
  currentPrice: number;
  stock: number;
  stockPercent: number;
  reviews: number;
}

export interface VoucherItem {
  _id?: string;
  id?: string;
  code: string;
  name: string;
  description?: string;
  type: 'shipping' | 'percent' | 'fixed';
  discountValue: number;
  minOrder?: number;
  maxDiscount?: number;
  startDate?: string;
  endDate?: string;
  quantity?: number;
  used?: number;
  isActive?: boolean;
}

@Component({
  selector: 'app-homepage',
  templateUrl: './homepage.html',
  styleUrls: ['./homepage.css'], 
  standalone: true, 
  imports: [CommonModule, RouterModule, FormsModule]
})
export class HomepageComponent implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly blogService = inject(BlogService);
  private readonly cart = inject(CartService);
  private readonly toast = inject(ToastService);
  private readonly changeDetectorRef = inject(ChangeDetectorRef);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  valuesData = [
    { icon: 'bi-shield-check', title: 'Chất liệu an toàn', desc: 'Hạt nhựa nguyên sinh không độc hại, an toàn cho mọi lứa tuổi' },
    { icon: 'bi-truck', title: 'Giao hàng nhanh chóng', desc: 'Ship COD toàn quốc, kiểm hàng trước khi nhận' },
    { icon: 'bi-headset', title: 'Hỗ trợ 24/7', desc: 'Tặng map mẫu và hướng dẫn ủi nhiệt miễn phí' }
  ];

  categoriesData = [
    { name: 'Bộ KIT DIY', image: 'assets/index/kit.jpg', category: 'kit' },
    { name: 'Dụng Cụ', image: 'assets/index/dungcu.png', category: 'tool' },
    { name: 'Hạt Lẻ Các Loại', image: 'assets/index/hatrefill.png', category: 'bead' },
    { name: 'Phụ Kiện Handmade', image: 'assets/index/handmade.jpg', category: 'accessory' }
  ];

  stepsData = [
    { number: '01', image: 'assets/index/step1.png', title: 'Xếp hạt lên bảng đinh', desc: 'Chọn màu sắc và xếp hạt nhựa lên bảng đinh theo map mẫu' },
    { number: '02', image: 'assets/index/step2.png', title: 'Phủ giấy nến & Ủi nhiệt', desc: 'Đặt giấy nến lên trên và ủi ở nhiệt độ phù hợp' },
    { number: '03', image: 'assets/index/step3.png', title: 'Hoàn thành tác phẩm', desc: 'Tháo sản phẩm hoàn thiện ra khỏi bảng đinh' }
  ];

  bestSellers: HomeProduct[] = [];
  communityPosts: BlogPost[] = [];
  isCommunityLoading = true;
  communityErrorMessage = '';
  isLoading = false;
  errorMessage = '';

  // ================= POPUP VOUCHER SINH NHẬT 50% =================
  isBirthdayModalOpen = false;
  birthdayFormName = '';
  birthdayFormBirth = '';
  birthdayFormPhone = '';
  isBirthLocked = false;
  isSubmittingBirthday = false;
  birthdayErrorMessage = '';
  birthdaySuccessMessage = '';

  // ================= POPUP VOUCHER =================
  isVoucherModalOpen = false;
  unclaimedVouchers: VoucherItem[] = [];
  isLoadingVouchers = false;
  voucherLoadError = '';
  voucherToastMessage = '';
  isClaimingMap: Record<string, boolean> = {};
  isClaimingAll = false;

  ngOnInit(): void {
    this.loadBestSellers();
    this.loadCommunityPosts();
  }

  private loadBestSellers(): void {
    if (!this.isBrowser) return;

    this.isLoading = true;
    this.errorMessage = '';

    this.http.get<unknown>('/api/products?page=1&limit=20').pipe(
      map((response) => this.extractProducts(response)),
    ).subscribe({
      next: (products) => {
        const sorted = [...products].sort((a, b) => b.reviews - a.reviews);
        this.bestSellers = sorted.slice(0, 4);
        this.isLoading = false;
        this.changeDetectorRef.markForCheck();
      },
      error: (error: unknown) => {
        console.error('Không thể tải danh sách sản phẩm bán chạy:', error);
        this.errorMessage = 'Không thể tải danh sách sản phẩm lúc này.';
        this.isLoading = false;
        this.changeDetectorRef.markForCheck();
      },
    });
  }

  private loadCommunityPosts(): void {
    if (!this.isBrowser) return;

    this.isCommunityLoading = true;
    this.communityErrorMessage = '';

    this.blogService.getBlogs().pipe(
      map((posts) => posts.slice(0, 12)),
    ).subscribe({
      next: (posts) => {
        this.communityPosts = posts;
        this.isCommunityLoading = false;
        this.changeDetectorRef.markForCheck();
      },
      error: (error: unknown) => {
        console.error('Không thể tải bài viết cộng đồng:', error);
        this.communityErrorMessage = 'Không thể tải bài viết cộng đồng lúc này.';
        this.isCommunityLoading = false;
        this.changeDetectorRef.markForCheck();
      },
    });
  }

  addToCart(item: HomeProduct): void {
    try {
      this.cart.addItem({ productId: String(item.id), quantity: 1, variant: null });
      this.toast.show(`Đã thêm "${item.name}" vào giỏ hàng.`);
      if (this.isBrowser) {
        window.dispatchEvent(new Event('cart:updated'));
      }
    } catch (error) {
      console.error('Không thể thêm vào giỏ hàng:', error);
      this.toast.show('Không thể thêm vào giỏ hàng. Vui lòng thử lại.');
    }
  }

  // ================= VOUCHER MODAL METHODS =================
  // ================= BIRTHDAY VOUCHER POPUP =================
  openBirthdayModal(): void {
    if (!this.isBrowser) return;

    const isLoggedIn = localStorage.getItem('isLoggedIn') === 'true';
    const token = localStorage.getItem('authToken') || '';

    if (!isLoggedIn || !token) {
      void this.router.navigate(['/login'], { queryParams: { returnUrl: '/' } });
      return;
    }

    this.birthdayErrorMessage = '';
    this.birthdaySuccessMessage = '';
    this.isSubmittingBirthday = false;

    // Lấy thông tin user hiện tại để pre-fill và kiểm tra xem đã có ngày sinh chưa
    const headers = new HttpHeaders({ Authorization: `Bearer ${token}` });
    this.http.get<any>('/api/auth/me', { headers }).subscribe({
      next: (user) => {
        this.birthdayFormName = user.name || '';
        this.birthdayFormPhone = user.phone || '';
        if (user.birth && typeof user.birth === 'string' && user.birth.trim()) {
          this.birthdayFormBirth = user.birth.trim();
          this.isBirthLocked = true; // Đã nhập trước đó -> KHÓA trường ngày sinh
        } else {
          this.birthdayFormBirth = '';
          this.isBirthLocked = false;
        }
        this.isBirthdayModalOpen = true;
        this.changeDetectorRef.markForCheck();
      },
      error: () => {
        this.isBirthdayModalOpen = true;
        this.changeDetectorRef.markForCheck();
      }
    });
  }

  closeBirthdayModal(): void {
    this.isBirthdayModalOpen = false;
    this.birthdayErrorMessage = '';
    this.birthdaySuccessMessage = '';
  }

  submitBirthdayVoucher(): void {
    if (!this.isBrowser) return;

    const name = (this.birthdayFormName || '').trim();
    const birth = (this.birthdayFormBirth || '').trim();
    const phone = (this.birthdayFormPhone || '').trim();

    if (!name) {
      this.birthdayErrorMessage = 'Vui lòng nhập họ và tên.';
      return;
    }
    if (!birth) {
      this.birthdayErrorMessage = 'Vui lòng nhập ngày tháng năm sinh.';
      return;
    }
    if (!phone) {
      this.birthdayErrorMessage = 'Vui lòng nhập số điện thoại.';
      return;
    }

    // Nếu ngày sinh đã bị khóa (đã nhập trước đó) thì KHÔNG cho nhận voucher lại
    if (this.isBirthLocked) {
      this.birthdayErrorMessage = 'Ngày sinh của bạn đã được đăng ký. Mỗi tài khoản chỉ nhận voucher sinh nhật 1 lần.';
      return;
    }

    const token = localStorage.getItem('isLoggedIn') === 'true'
      ? localStorage.getItem('authToken') || ''
      : '';

    if (!token) {
      this.closeBirthdayModal();
      void this.router.navigate(['/login'], { queryParams: { returnUrl: '/' } });
      return;
    }

    this.isSubmittingBirthday = true;
    this.birthdayErrorMessage = '';
    this.birthdaySuccessMessage = '';

    const headers = new HttpHeaders({ Authorization: `Bearer ${token}` });
    this.http.post<any>('/api/user-vouchers/claim-birthday', {
      name,
      birth,
      phone
    }, { headers }).pipe(
      finalize(() => {
        this.isSubmittingBirthday = false;
        this.changeDetectorRef.markForCheck();
      })
    ).subscribe({
      next: (res) => {
        this.birthdaySuccessMessage = res.message || 'Nhận voucher thành công';
        this.isBirthLocked = true; // Sau khi nhập thành công thì khóa luôn ô ngày sinh
        this.toast.show(this.birthdaySuccessMessage, 'success');
        this.changeDetectorRef.markForCheck();
        setTimeout(() => {
          this.closeBirthdayModal();
        }, 1800);
      },
      error: (err) => {
        this.birthdayErrorMessage = err.error?.message || 'Không thể nhận voucher lúc này. Vui lòng thử lại.';
        this.changeDetectorRef.markForCheck();
      }
    });
  }

  openVoucherModal(): void {
    this.isVoucherModalOpen = true;
    this.voucherToastMessage = '';
    this.voucherLoadError = '';
    this.loadUnclaimedVouchers();
  }

  closeVoucherModal(): void {
    this.isVoucherModalOpen = false;
  }

  loadUnclaimedVouchers(): void {
    if (!this.isBrowser) return;

    this.isLoadingVouchers = true;
    this.voucherLoadError = '';

    const token = localStorage.getItem('isLoggedIn') === 'true'
      ? localStorage.getItem('authToken') || ''
      : '';

    const headers = token
      ? new HttpHeaders({ Authorization: `Bearer ${token}` })
      : new HttpHeaders();

    this.http.get<any>('/api/user-vouchers/available', { headers }).pipe(
      finalize(() => {
        this.isLoadingVouchers = false;
        this.changeDetectorRef.markForCheck();
      })
    ).subscribe({
      next: (res) => {
        this.unclaimedVouchers = Array.isArray(res?.vouchers) ? res.vouchers : [];
        this.changeDetectorRef.markForCheck();
      },
      error: (err) => {
        console.error('Lỗi tải danh sách voucher:', err);
        this.voucherLoadError = 'Không thể tải danh sách voucher. Vui lòng thử lại sau.';
        this.changeDetectorRef.markForCheck();
      }
    });
  }

  claimSingleVoucher(voucher: VoucherItem): void {
    if (!this.isBrowser) return;

    const isLoggedIn = localStorage.getItem('isLoggedIn') === 'true';
    const token = localStorage.getItem('authToken') || '';

    if (!isLoggedIn || !token) {
      this.closeVoucherModal();
      void this.router.navigate(['/login'], { queryParams: { returnUrl: '/' } });
      return;
    }

    const vId = voucher.id || voucher._id || voucher.code;
    this.isClaimingMap[vId] = true;
    this.voucherToastMessage = '';

    const headers = new HttpHeaders({ Authorization: `Bearer ${token}` });

    this.http.post<any>('/api/user-vouchers/claim', { voucherId: vId }, { headers }).pipe(
      finalize(() => {
        this.isClaimingMap[vId] = false;
        this.changeDetectorRef.markForCheck();
      })
    ).subscribe({
      next: (res) => {
        this.voucherToastMessage = res.message || `Đã nhận voucher "${voucher.code}" thành công!`;
        // Loại bỏ voucher vừa nhận khỏi danh sách chưa có
        this.unclaimedVouchers = this.unclaimedVouchers.filter(v => (v.id || v._id || v.code) !== vId);
        this.changeDetectorRef.markForCheck();
      },
      error: (err) => {
        this.voucherToastMessage = err.error?.message || 'Không thể nhận voucher lúc này.';
        this.changeDetectorRef.markForCheck();
      }
    });
  }

  claimAllVouchers(): void {
    if (!this.isBrowser) return;

    const isLoggedIn = localStorage.getItem('isLoggedIn') === 'true';
    const token = localStorage.getItem('authToken') || '';

    if (!isLoggedIn || !token) {
      this.closeVoucherModal();
      void this.router.navigate(['/login'], { queryParams: { returnUrl: '/' } });
      return;
    }

    if (this.isClaimingAll || !this.unclaimedVouchers.length) return;

    this.isClaimingAll = true;
    this.voucherToastMessage = '';

    const headers = new HttpHeaders({ Authorization: `Bearer ${token}` });

    this.http.post<any>('/api/user-vouchers/claim-all', {}, { headers }).pipe(
      finalize(() => {
        this.isClaimingAll = false;
        this.changeDetectorRef.markForCheck();
      })
    ).subscribe({
      next: (res) => {
        this.voucherToastMessage = res.message || 'Chúc mừng bạn đã nhận tất cả voucher!';
        this.unclaimedVouchers = [];
        this.changeDetectorRef.markForCheck();
      },
      error: (err) => {
        this.voucherToastMessage = err.error?.message || 'Không thể nhận tất cả voucher lúc này.';
        this.changeDetectorRef.markForCheck();
      }
    });
  }

  formatVoucherDiscount(voucher: VoucherItem): string {
    if (voucher.type === 'percent') {
      return `Giảm ${voucher.discountValue}%`;
    }
    if (voucher.type === 'shipping') {
      return `Freeship ${Number(voucher.discountValue).toLocaleString('vi-VN')}đ`;
    }
    return `Giảm ${Number(voucher.discountValue).toLocaleString('vi-VN')}đ`;
  }

  private extractProducts(response: unknown): HomeProduct[] {
    const list = Array.isArray(response)
      ? response
      : this.isRecord(response) && Array.isArray(response['products'])
        ? response['products']
        : this.isRecord(response) && Array.isArray(response['data'])
          ? response['data']
          : [];

    return list.flatMap((item: unknown) => {
      if (!this.isRecord(item)) return [];

      const record = item as Record<string, unknown>;
      const rawId = record['id'] ?? record['_id'] ?? record['productId'];
      const id = typeof rawId === 'string' || typeof rawId === 'number'
        ? rawId
        : typeof record['_id'] === 'string'
          ? record['_id']
          : null;
      const name = record['name'] ?? record['productName'];
      if (id === null || typeof name !== 'string') return [];

      const rawImage = record['image'] ?? record['imageUrl'] ?? record['images'];
      const image = typeof rawImage === 'string'
        ? rawImage
        : Array.isArray(rawImage) && typeof rawImage[0] === 'string'
          ? rawImage[0]
          : 'assets/product/7.png';
      const normalizedImage = image.startsWith('images/')
        ? `/api/images/${image.slice('images/'.length)}`
        : image.startsWith('/images/')
          ? `/api/images/${image.slice('/images/'.length)}`
          : image;
      const originalPrice = this.toNumber(record['originalPrice'] ?? record['price']);
      const currentPrice = this.toNumber(record['currentPrice'] ?? record['salePrice'] ?? originalPrice);
      const stock = this.toNumber(record['stock'] ?? record['quantity']);
      const discountPercent = originalPrice > currentPrice && originalPrice > 0
        ? Math.round((1 - currentPrice / originalPrice) * 100)
        : 0;

      return [{
        id,
        slug: typeof record['slug'] === 'string' && record['slug'].trim()
          ? record['slug'].trim()
          : this.slugify(name),
        name,
        image: normalizedImage,
        isSale: record['isSale'] === true || discountPercent > 0,
        badge: discountPercent > 0 ? `-${discountPercent}%` : 'Ưu đãi',
        originalPrice,
        currentPrice,
        stock,
        stockPercent: this.toNumber(record['stockPercent']) || Math.min(stock, 100),
        reviews: this.toNumber(record['reviews'] ?? record['reviewCount']),
      }];
    });
  }

  private toNumber(value: unknown): number {
    const number = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(number) ? number : 0;
  }

  private slugify(value: string): string {
    return value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[đĐ]/g, 'd')
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
  }

  trackProduct(index: number, item: HomeProduct): any {
    return item?.id || index;
  }

  trackCommunityPost(index: number, post: BlogPost): any {
    return post?.id || index;
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }
}
