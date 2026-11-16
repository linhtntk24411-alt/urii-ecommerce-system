import { CommonModule, isPlatformBrowser } from '@angular/common';
import { ChangeDetectorRef, Component, DestroyRef, OnInit, OnDestroy, PLATFORM_ID, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { FavoriteProductsService } from '../../core/services/favorite-products.service';
import { CartService } from '../../core/services/cart.service';
import { CheckoutSelectionService } from '../../core/services/checkout-selection.service';
import { ToastService } from '../../core/services/toast.service';
import { DialogService } from '../../core/services/dialog.service';

interface ProductVariant {
  name: string;
}

interface ProductItem {
  id: string | number;
  slug?: string;
  name: string;
  category: string;
  description: string;
  image: string;
  originalPrice: number;
  currentPrice?: number;
  isSale: boolean;
  isHot: boolean;
  rating: number;
  reviews: number;
  stock: number;
  variants: ProductVariant[];
}

interface PaginationItem {
  label: number | string;
  page: number | null;
}

type SortOption = 'popular' | 'price-asc' | 'price-desc' | 'sale';

@Component({
  selector: 'app-product',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './product.html',
  styleUrl: './product.css',
})
export class Product implements OnInit, OnDestroy {
  private productPollTimer: any;
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly changeDetectorRef = inject(ChangeDetectorRef);
  private readonly favorites = inject(FavoriteProductsService);
  private readonly cart = inject(CartService);
  private readonly checkoutSelection = inject(CheckoutSelectionService);
  private readonly toast = inject(ToastService);
  private readonly dialogService = inject(DialogService);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
  private readonly itemsPerPage = 9;

  allProducts: ProductItem[] = [];
  filteredProducts: ProductItem[] = [];
  currentPage = 1;
  loading = true;
  errorMessage = '';
  statusMessage = '';
  refreshFailed = false;
  category = '';
  searchTerm = '';
  favoritesOnly = false;
  selectedPriceRanges: string[] = [];
  selectedPromotions: string[] = [];
  selectedRating = 'all';
  sortBy: SortOption = 'popular';

  ngOnInit(): void {
    this.route.queryParamMap
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((params) => {
        this.category = params.get('category') ?? '';
        this.searchTerm = params.get('search') ?? '';
        this.applyFilters();
      });
    this.favoritesOnly = this.route.snapshot.data['favoritesOnly'] === true;
    if (this.favoritesOnly && this.isBrowser && !this.isLoggedIn()) {
      this.dialogService.promptLogin({
        title: 'Đăng nhập để xem sản phẩm yêu thích',
        description: 'Vui lòng đăng nhập để xem danh sách các sản phẩm yêu thích của bạn.',
        returnUrl: '/favorites'
      });
      void this.router.navigate(['/products']);
      return;
    }

    if (this.isBrowser) {
      void this.loadProducts();
      this.productPollTimer = setInterval(() => {
        void this.refreshProductsSilently();
      }, 4000);
    }
  }

  get pageProducts(): ProductItem[] {
    const start = (this.currentPage - 1) * this.itemsPerPage;
    return this.filteredProducts.slice(start, start + this.itemsPerPage);
  }

  get totalPages(): number {
    return Math.ceil(this.filteredProducts.length / this.itemsPerPage);
  }

  get paginationItems(): PaginationItem[] {
    const pages = new Set<number>([1, this.totalPages]);
    for (let page = Math.max(1, this.currentPage - 2); page <= Math.min(this.totalPages, this.currentPage + 2); page++) {
      pages.add(page);
    }

    const sortedPages = [...pages].filter((page) => page > 0).sort((a, b) => a - b);
    const items: PaginationItem[] = [];
    sortedPages.forEach((page, index) => {
      if (index > 0 && page - sortedPages[index - 1] > 1) {
        items.push({ label: '…', page: null });
      }
      items.push({ label: page, page });
    });
    return items;
  }

  get productCountText(): string {
    if (this.filteredProducts.length === 0) {
      return 'Không có sản phẩm';
    }
    const start = (this.currentPage - 1) * this.itemsPerPage + 1;
    const end = Math.min(this.currentPage * this.itemsPerPage, this.filteredProducts.length);
    return `Hiển thị ${start}-${end} trong số ${this.filteredProducts.length} sản phẩm`;
  }

  get hasCategoryContext(): boolean {
    return Boolean(this.category || this.searchTerm);
  }

  isFavorite(productId: string | number): boolean {
    return this.favorites.has(productId);
  }

  toggleFavorite(product: ProductItem): void {
    if (!this.isLoggedIn()) {
      this.dialogService.promptLogin({
        title: 'Đăng nhập để lưu sản phẩm yêu thích',
        description: 'Vui lòng đăng nhập để lưu sản phẩm vào danh sách yêu thích của bạn.',
        returnUrl: this.router.url
      });
      return;
    }

    try {
      const saved = this.favorites.toggle(product.id);
      if (this.favoritesOnly && !saved) {
        this.applyFilters();
      }
      this.dialogService.alert(saved ? 'Đã lưu sản phẩm vào danh sách yêu thích.' : 'Đã xóa sản phẩm khỏi danh sách yêu thích.', 'Danh sách yêu thích', 'success');
    } catch {
      this.dialogService.alert('Không thể lưu sản phẩm yêu thích. Vui lòng thử lại.', 'Lỗi', 'error');
    }
  }

  private isLoggedIn(): boolean {
    return this.isBrowser && (
      window.localStorage.getItem('isLoggedIn') === 'true' ||
      Boolean(window.localStorage.getItem('authToken')) ||
      Boolean(window.localStorage.getItem('urii.auth.token'))
    );
  }

  getCategoryLabel(category: string): string {
    const labels: Record<string, string> = {
      kit: 'Bộ KIT DIY',
      tool: 'Dụng cụ',
      bead: 'Hạt lẻ',
      accessory: 'Phụ kiện Handmade',
      KIT: 'Bộ KIT DIY',
      DC: 'Dụng cụ',
      HN: 'Hạt lẻ',
      TP: 'Thành phẩm',
      BST: 'Bộ sưu tập',
    };
    return labels[category] ?? 'Tất cả sản phẩm';
  }

  hasDiscount(product: ProductItem): boolean {
    return product.isSale
      && product.currentPrice !== undefined
      && product.currentPrice < product.originalPrice;
  }

  discountPercent(product: ProductItem): number {
    if (!this.hasDiscount(product) || product.originalPrice <= 0 || product.currentPrice === undefined) {
      return 0;
    }
    return Math.round((1 - product.currentPrice / product.originalPrice) * 100);
  }

  displayPrice(product: ProductItem): number {
    return product.currentPrice ?? product.originalPrice;
  }

  formatPrice(price: number): string {
    return `${price.toLocaleString('vi-VN')}₫`;
  }

  starIcons(rating: number): string[] {
    const value = Math.max(0, Math.min(5, rating));
    const fullStars = Math.floor(value);
    const hasHalfStar = value - fullStars >= 0.5;
    return Array.from({ length: 5 }, (_, index) => {
      if (index < fullStars) {
        return 'bi bi-star-fill';
      }
      if (index === fullStars && hasHalfStar) {
        return 'bi bi-star-half';
      }
      return 'bi bi-star';
    });
  }

  toggleFilter(values: string[], value: string, event: Event): void {
    const target = event.target;
    const checked = target instanceof HTMLInputElement && target.checked;
    if (checked && !values.includes(value)) {
      values.push(value);
    } else if (!checked) {
      const index = values.indexOf(value);
      if (index >= 0) {
        values.splice(index, 1);
      }
    }
    this.applyFilters();
  }

  setRatingFilter(rating: string): void {
    this.selectedRating = rating;
    this.applyFilters();
  }

  onSortChange(event: Event): void {
    const target = event.target;
    const value = target instanceof HTMLSelectElement ? target.value : '';
    if (value === 'popular' || value === 'price-asc' || value === 'price-desc' || value === 'sale') {
      this.sortBy = value;
      this.applyFilters();
    }
  }

  clearFilters(): void {
    this.selectedPriceRanges = [];
    this.selectedPromotions = [];
    this.selectedRating = 'all';
    this.sortBy = 'popular';
    this.applyFilters();
  }

  changePage(page: number): void {
    if (page < 1 || page > this.totalPages) {
      return;
    }
    this.currentPage = page;
    if (this.isBrowser) {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }

  async loadProducts(): Promise<void> {
    const cachedProducts = this.readCachedProducts();
    this.loading = true;
    this.statusMessage = '';
    this.errorMessage = '';
    this.refreshFailed = false;

    try {
      if (this.isBrowser && this.isLoggedIn()) {
        try {
          await this.favorites.syncWithServer();
        } catch (error) {
          console.error('Không thể tải danh sách sản phẩm yêu thích từ server:', error);
        }
      }

      const response = await window.fetch('/api/products');
      if (!response.ok) {
        throw new Error(`Không thể tải sản phẩm từ server (HTTP ${response.status})`);
      }

      const products = this.parseProducts(await response.json());
      this.allProducts = products;
      try {
        window.localStorage.setItem('products', JSON.stringify(products));
      } catch (error) {
        console.error('Không thể lưu bộ nhớ đệm sản phẩm:', error);
      }
      this.loading = false;
      this.statusMessage = '';
      this.applyFilters();
    } catch (error) {
      console.error('Lỗi tải sản phẩm từ MongoDB:', error);
      this.loading = false;
      if (cachedProducts.length > 0) {
        this.allProducts = cachedProducts;
        this.applyFilters();
        this.statusMessage = 'Không thể cập nhật. Đang hiển thị danh sách đã lưu.';
        this.refreshFailed = true;
      } else {
        this.errorMessage = 'Không thể tải sản phẩm từ server. Vui lòng kiểm tra kết nối và thử lại.';
        this.allProducts = [];
        this.filteredProducts = [];
      }
    } finally {
      this.changeDetectorRef.markForCheck();
    }
  }

  addToCart(product: ProductItem): void {
    const variant = product.variants[0]?.name ?? null;
    try {
      this.cart.addItem({ productId: String(product.id), variant, quantity: 1 });
      this.toast.show(`Đã thêm "${product.name}" vào giỏ hàng.`);
    } catch (error) {
      console.error('Không thể thêm sản phẩm vào giỏ hàng:', error);
      this.toast.show('Không thể cập nhật giỏ hàng. Vui lòng thử lại.', 'error');
    }
  }

  buyNow(product: ProductItem): void {
    const variant = product.variants[0]?.name ?? null;
    try {
      const item = { productId: String(product.id), variant, quantity: 1 };
      this.checkoutSelection.set([item], false);
      void this.router.navigate(['/checkout']);
    } catch (error) {
      console.error('Không thể chuẩn bị sản phẩm thanh toán:', error);
      this.toast.show('Không thể chuyển đến thanh toán. Vui lòng thử lại.', 'error');
    }
  }

  ngOnDestroy(): void {
    if (this.productPollTimer) {
      clearInterval(this.productPollTimer);
    }
  }

  private async refreshProductsSilently(): Promise<void> {
    if (!this.isBrowser || this.loading) return;
    try {
      const response = await window.fetch('/api/products');
      if (!response.ok) return;
      const products = this.parseProducts(await response.json());
      const currentSig = this.allProducts.map(p => `${p.id}_${p.currentPrice || p.originalPrice}_${p.stock}`).join('|');
      const newSig = products.map(p => `${p.id}_${p.currentPrice || p.originalPrice}_${p.stock}`).join('|');
      if (currentSig !== newSig) {
        this.allProducts = products;
        try {
          window.localStorage.setItem('products', JSON.stringify(products));
        } catch (_) {}
        this.applyFilters();
        this.changeDetectorRef.markForCheck();
      }
    } catch (_) {}
  }

  private applyFilters(): void {
    let filtered = [...this.allProducts];

    if (this.favoritesOnly) {
      const favoriteIds = new Set(this.favorites.getProductIds());
      filtered = filtered.filter((product) => favoriteIds.has(String(product.id)));
    }

    if (this.category) {
      const categoryCodes: Record<string, string[]> = {
        kit: ['KIT'],
        tool: ['DC'],
        bead: ['HN'],
        accessory: ['TP'],
      };
      const matchingCodes = categoryCodes[this.category.toLocaleLowerCase()]
        ?? [this.category.toLocaleUpperCase()];
      filtered = filtered.filter((product) => matchingCodes.includes(product.category.toLocaleUpperCase()));
    }

    const term = this.normalize(this.searchTerm.trim());
    if (term) {
      filtered = filtered.filter((product) =>
        [product.name, product.category, product.description]
          .some((value) => this.normalize(value).includes(term)),
      );
    }

    if (this.selectedPriceRanges.length > 0) {
      filtered = filtered.filter((product) => {
        const price = this.displayPrice(product);
        return this.selectedPriceRanges.some((range) => {
          if (range === 'under-50') return price < 50000;
          if (range === '50-200') return price >= 50000 && price <= 200000;
          if (range === 'over-200') return price > 200000;
          return false;
        });
      });
    }

    if (this.selectedPromotions.length > 0) {
      filtered = filtered.filter((product) =>
        (this.selectedPromotions.includes('sale') && product.isSale)
        || (this.selectedPromotions.includes('hot') && product.isHot),
      );
    }

    if (this.selectedRating === 'below-3') {
      filtered = filtered.filter((product) => product.rating < 3);
    } else if (this.selectedRating !== 'all') {
      const minimumRating = Number(this.selectedRating);
      filtered = filtered.filter((product) => product.rating >= minimumRating);
    }

    filtered.sort((a, b) => {
      switch (this.sortBy) {
        case 'price-asc':
          return this.displayPrice(a) - this.displayPrice(b);
        case 'price-desc':
          return this.displayPrice(b) - this.displayPrice(a);
        case 'sale':
          return this.discountPercent(b) - this.discountPercent(a);
        case 'popular':
        default:
          return b.reviews - a.reviews;
      }
    });

    this.filteredProducts = filtered;
    this.currentPage = 1;
  }

  private parseProducts(data: unknown): ProductItem[] {
    const rawProducts = Array.isArray(data)
      ? data
      : this.isRecord(data) && Array.isArray(data['products'])
        ? data['products']
        : [];

    return rawProducts.flatMap((item): ProductItem[] => {
      if (!this.isRecord(item)) {
        return [];
      }

      const rawId = item['id'] ?? item['_id'];
      const id = typeof rawId === 'string' || typeof rawId === 'number'
        ? rawId
        : this.isRecord(rawId) && typeof rawId['$oid'] === 'string'
          ? rawId['$oid']
          : null;
      const name = item['name'] ?? item['productName'];
      if (id === null || typeof name !== 'string') {
        return [];
      }
      const slug = typeof item['slug'] === 'string' && item['slug'].trim()
        ? item['slug'].trim()
        : this.slugify(name);

      const variants = Array.isArray(item['variants'])
        ? item['variants'].flatMap((variant): ProductVariant[] =>
          this.isRecord(variant) && typeof variant['name'] === 'string'
            ? [{ name: variant['name'] }]
            : [],
        )
        : [];
      const rawImage = item['image'] ?? item['imageUrl'] ?? item['images'];
      const image = typeof rawImage === 'string'
        ? rawImage
        : Array.isArray(rawImage) && typeof rawImage[0] === 'string'
          ? rawImage[0]
          : 'assets/product/7.png';
      const originalPrice = this.toNumber(item['originalPrice'] ?? item['price']);
      const currentPrice = this.optionalNumber(item['currentPrice'] ?? item['salePrice']);
      const category = item['category'];
      const categoryName = this.isRecord(category) ? category['name'] : category;
      const reviewRecords = Array.isArray(item['reviews'])
        ? item['reviews']
        : Array.isArray(item['customerReviews'])
          ? item['customerReviews']
          : [];
      const reviewRatings = reviewRecords.flatMap((review): number[] => {
        if (!this.isRecord(review)) return [];
        const rating = this.optionalNumber(review['rating'] ?? review['rate'] ?? review['stars']);
        return rating !== undefined && rating >= 1 && rating <= 5 ? [rating] : [];
      });
      const rating = reviewRatings.length
        ? reviewRatings.reduce((sum, value) => sum + value, 0) / reviewRatings.length
        : this.toNumber(item['rating']);
      const reviewCount = Array.isArray(item['reviews'])
        ? item['reviews'].length
        : Array.isArray(item['customerReviews'])
          ? item['customerReviews'].length
          : this.toNumber(item['reviewCount'] ?? item['reviewsCount'] ?? item['reviews']);

      return [{
        id,
        slug,
        name,
        category: typeof categoryName === 'string' ? categoryName : '',
        description: typeof item['description'] === 'string' ? item['description'] : '',
        image,
        originalPrice,
        currentPrice,
        isSale: item['isSale'] === true || (currentPrice !== undefined && currentPrice < originalPrice),
        isHot: item['isHot'] === true,
        rating,
        reviews: reviewCount,
        stock: this.toNumber(item['stock'] ?? item['quantity']),
        variants,
      }];
    });
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

  private normalize(value: string): string {
    return value.normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLocaleLowerCase('vi');
  }

  private readCachedProducts(): ProductItem[] {
    try {
      const saved = window.localStorage.getItem('products');
      return saved ? this.parseProducts(JSON.parse(saved)) : [];
    } catch (error) {
      console.error('Không thể đọc bộ nhớ đệm sản phẩm:', error);
      return [];
    }
  }

  private optionalNumber(value: unknown): number | undefined {
    if (value === null || value === undefined || value === '') {
      return undefined;
    }
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  private toNumber(value: unknown): number {
    return this.optionalNumber(value) ?? 0;
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }
}
