import { CommonModule, isPlatformBrowser } from '@angular/common';
import { Component, DestroyRef, OnInit, PLATFORM_ID, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';

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

interface CartItem {
  productId: string | number;
  variant: string | null;
  quantity: number;
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
export class Product implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
  private readonly itemsPerPage = 9;

  allProducts: ProductItem[] = [];
  filteredProducts: ProductItem[] = [];
  currentPage = 1;
  loading = true;
  errorMessage = '';
  statusMessage = '';
  refreshFailed = false;
  cartMessage = '';
  category = '';
  searchTerm = '';
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

    if (this.isBrowser) {
      void this.loadProducts();
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
    if (cachedProducts.length > 0) {
      this.allProducts = cachedProducts;
      this.loading = false;
      this.applyFilters();
      this.statusMessage = 'Đang cập nhật danh sách sản phẩm...';
    } else {
      this.loading = true;
      this.statusMessage = '';
    }

    this.errorMessage = '';
    this.refreshFailed = false;

    try {
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
        this.statusMessage = 'Không thể cập nhật. Đang hiển thị danh sách đã lưu.';
        this.refreshFailed = true;
      } else {
        this.errorMessage = 'Không thể tải sản phẩm từ server. Vui lòng kiểm tra kết nối và thử lại.';
        this.allProducts = [];
        this.filteredProducts = [];
      }
    }
  }

  addToCart(product: ProductItem): void {
    const cartItems = this.readCartItems();
    const variant = product.variants[0]?.name ?? null;
    const existingItem = cartItems.find(
      (item) => item.productId === product.id && item.variant === variant,
    );

    if (existingItem) {
      existingItem.quantity += 1;
    } else {
      cartItems.push({ productId: product.id, variant, quantity: 1 });
    }

    if (this.saveCartItems(cartItems)) {
      this.cartMessage = `Đã thêm "${product.name}" vào giỏ hàng!`;
    }
  }

  buyNow(product: ProductItem): void {
    const variant = product.variants[0]?.name ?? null;
    const cartItems = this.readCartItems();
    const existingItem = cartItems.find(
      (item) => item.productId === product.id && item.variant === variant,
    );

    if (!existingItem && !this.saveCartItems([...cartItems, { productId: product.id, variant, quantity: 1 }])) {
      return;
    }

    try {
      window.localStorage.setItem(
        'checkoutItems',
        JSON.stringify([{ productId: product.id, variant, quantity: 1 }]),
      );
      window.location.href = '/checkout.html';
    } catch (error) {
      console.error('Không thể lưu sản phẩm thanh toán:', error);
      this.cartMessage = 'Không thể chuyển đến thanh toán. Vui lòng thử lại.';
    }
  }

  private applyFilters(): void {
    let filtered = [...this.allProducts];

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

    const term = this.searchTerm.trim().toLocaleLowerCase();
    if (term) {
      filtered = filtered.filter((product) =>
        [product.name, product.category, product.description]
          .some((value) => value.toLocaleLowerCase().includes(term)),
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
        rating: this.toNumber(item['rating']),
        reviews: this.toNumber(item['reviews'] ?? item['reviewCount']),
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

  private readCachedProducts(): ProductItem[] {
    try {
      const saved = window.localStorage.getItem('products');
      return saved ? this.parseProducts(JSON.parse(saved)) : [];
    } catch (error) {
      console.error('Không thể đọc bộ nhớ đệm sản phẩm:', error);
      return [];
    }
  }

  private readCartItems(): CartItem[] {
    try {
      const saved = window.localStorage.getItem('cartItems');
      const parsed: unknown = saved ? JSON.parse(saved) : [];
      if (!Array.isArray(parsed)) {
        return [];
      }

      return parsed.flatMap((item): CartItem[] => {
        if (
          !this.isRecord(item)
          || (typeof item['productId'] !== 'string' && typeof item['productId'] !== 'number')
          || typeof item['quantity'] !== 'number'
        ) {
          return [];
        }
        return [{
          productId: item['productId'],
          variant: typeof item['variant'] === 'string' ? item['variant'] : null,
          quantity: item['quantity'],
        }];
      });
    } catch (error) {
      console.error('Không thể đọc giỏ hàng:', error);
      return [];
    }
  }

  private saveCartItems(items: CartItem[]): boolean {
    try {
      window.localStorage.setItem('cartItems', JSON.stringify(items));
      window.dispatchEvent(new CustomEvent('cart:updated', { detail: items }));
      window.dispatchEvent(new Event('storage'));
      return true;
    } catch (error) {
      console.error('Không thể lưu giỏ hàng:', error);
      this.cartMessage = 'Không thể cập nhật giỏ hàng. Vui lòng thử lại.';
      return false;
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
